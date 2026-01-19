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

      // Envio de E-mail para o Admin (Automação)
      // Requer variáveis de ambiente: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
      if (process.env.SMTP_HOST) {
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

          await transporter.sendMail({
            from: `"CoraEats Bot" <${process.env.SMTP_USER}>`,
            to: "coraeatssuporte@gmail.com", // Seu e-mail de admin
            subject: `💰 Nova Venda: ${customer.name || "Cliente"}`,
            text: `Nova venda confirmada!\n\n👤 Cliente: ${customer.name}\n📧 Email: ${customer.email}\n📱 Telefone: ${customer.phone}\n📦 Produto/Domínio: ${productName}\n🆔 ID Pagamento: ${paymentId}\n\nAcesse o Dashboard para gerar a licença e o contrato.`,
          });
        } catch (emailErr) {
          console.error("Erro ao enviar e-mail de notificação:", emailErr);
        }
      }

      // Busca a licença que tem esse ID de pagamento
      const licensesRef = db.collection("licenses");
      const snapshot = await licensesRef
        .where("paymentId", "==", paymentId)
        .get();

      if (snapshot.empty) {
        console.log("Nenhuma licença encontrada para o pagamento:", paymentId);
        return res
          .status(200)
          .json({ received: true, status: "no_license_found" });
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
