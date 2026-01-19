import admin from "firebase-admin";
import nodemailer from "nodemailer";

// Inicializa o Firebase Admin (necessário para escrever no banco pelo backend)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
    ),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const event = req.body;

  try {
    // Verifique na documentação do Abacate Pay qual o status de sucesso (ex: "PAID", "COMPLETED")
    if (event.status === "PAID" || event.event === "billing.paid") {
      const paymentId = event.data.id;
      const customer = event.data.customer || {};
      const products = event.data.products || [];
      const productName =
        products.length > 0 ? products[0].name : "Produto Desconhecido";
      const baseUrl = `https://${req.headers.host}`;

      // Envio de E-mail para o Admin (Automação)
      // Requer variáveis de ambiente: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
      if (process.env.SMTP_HOST) {
        console.log("Tentando enviar e-mail de notificação...");
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_PORT == 465, // true para 465, false para outros
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          });

          const htmlContent = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #10b981; margin: 0; font-size: 24px;">💰 Nova Venda Confirmada!</h1>
                <p style="color: #6b7280; margin-top: 8px;">O sistema registrou um novo pagamento.</p>
              </div>
              
              <div style="background-color: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                <h2 style="color: #111827; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; margin-top: 0;">👤 Dados do Cliente</h2>
                <p style="margin: 8px 0; color: #374151;"><strong>Nome:</strong> ${customer.name || "Não informado"}</p>
                <p style="margin: 8px 0; color: #374151;"><strong>E-mail:</strong> ${customer.email || "Não informado"}</p>
                <p style="margin: 8px 0; color: #374151;"><strong>Telefone:</strong> ${customer.phone || "Não informado"}</p>
                
                <h2 style="color: #111827; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; margin-top: 24px;">📦 Detalhes do Pedido</h2>
                <p style="margin: 8px 0; color: #374151;"><strong>Produto:</strong> ${productName}</p>
                <p style="margin: 8px 0; color: #374151;"><strong>ID Pagamento:</strong> <code style="background-color: #f3f4f6; padding: 2px 4px; border-radius: 4px;">${paymentId}</code></p>
              </div>

              <div style="text-align: center; margin-top: 32px;">
                <a href="${baseUrl}/dashboard.html" style="background-color: #f47c2c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; transition: background-color 0.2s;">Acessar Dashboard</a>
                <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">Este é um e-mail automático do sistema CoraEats.</p>
              </div>
            </div>
          `;

          await transporter.sendMail({
            from: `"CoraEats Bot" <${process.env.SMTP_USER}>`,
            to: "coraeatssuporte@gmail.com", // Seu e-mail de admin
            subject: `💰 Nova Venda: ${customer.name || "Cliente"}`,
            text: `Nova venda confirmada!\n\n👤 Cliente: ${customer.name}\n📧 Email: ${customer.email}\n📱 Telefone: ${customer.phone}\n📦 Produto/Domínio: ${productName}\n🆔 ID Pagamento: ${paymentId}\n\nAcesse o Dashboard para gerar a licença e o contrato.`,
            html: htmlContent,
          });
          console.log("E-mail enviado com sucesso!");
        } catch (emailErr) {
          console.error("Erro ao enviar e-mail de notificação:", emailErr);
        }
      } else {
        console.log("SMTP_HOST não configurado. Pulei o envio de e-mail.");
      }

      // Busca a licença que tem esse ID de pagamento
      const licensesRef = db.collection("licenses");
      const snapshot = await licensesRef
        .where("paymentId", "==", paymentId)
        .get();

      if (snapshot.empty) {
        // Cria uma notificação para o admin no Dashboard
        await db.collection("notifications").add({
          type: "sale_site_no_license",
          customer: customer,
          paymentId: paymentId,
          productName: productName,
          amount: event.data.amount || 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
        });

        console.log("Nenhuma licença encontrada. Notificação criada.");
        return res
          .status(200)
          .json({ received: true, status: "notification_created" });
      }

      // Atualiza a licença para ATIVA
      const batch = db.batch();
      snapshot.forEach((doc) => {
        batch.update(doc.ref, {
          active: false, // Mantém inativa até o cliente assinar o contrato
          status: "paid", // Status 'paid' libera o acesso à página de contrato
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();

      // Aqui você poderia enviar um e-mail para o cliente com a chave (usando Resend, SendGrid, etc)
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erro Webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
