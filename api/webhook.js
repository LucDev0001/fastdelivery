import admin from "firebase-admin";
import nodemailer from "nodemailer";

/**
 * Configuração obrigatória para Webhook (Vercel)
 */
export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Inicializa Firebase Admin
 */
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT não configurado.");
  }

  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
    ),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const event = req.body;

  console.log("Webhook recebido:", JSON.stringify(event, null, 2));

  try {
    /**
     * Normalização do evento Abacate Pay
     */
    const eventType = event.event || event.type || null;
    const data = event.data || {};
    const status = data.status || event.status || null;

    const isPaid =
      status === "PAID" ||
      status === "COMPLETED" ||
      eventType === "billing.paid";

    if (!isPaid) {
      console.log("Evento ignorado:", eventType || status);
      return res.status(200).json({ received: true, ignored: true });
    }

    /**
     * Dados essenciais
     */
    const paymentId = data.id;
    if (!paymentId) {
      throw new Error("paymentId não encontrado no webhook.");
    }

    const customer = data.customer || {};
    const products = data.products || [];
    const productName =
      products.length > 0 ? products[0].name : "Produto não identificado";

    const amount = data.amount || 0;
    const baseUrl = `https://${req.headers.host}`;

    /* =====================================================
     * ENVIO DE EMAIL PARA ADMIN
     * ===================================================== */
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      try {
        console.log("Enviando e-mail de notificação...");

        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2 style="color:#16a34a;">💰 Pagamento Confirmado</h2>
            <p><strong>Cliente:</strong> ${customer.name || "Não informado"}</p>
            <p><strong>Email:</strong> ${customer.email || "Não informado"}</p>
            <p><strong>Telefone:</strong> ${customer.phone || "Não informado"}</p>
            <hr />
            <p><strong>Produto:</strong> ${productName}</p>
            <p><strong>Valor:</strong> R$ ${(amount / 100).toFixed(2)}</p>
            <p><strong>ID Pagamento:</strong> ${paymentId}</p>
            <br />
            <a href="${baseUrl}/dashboard.html"
              style="display:inline-block;padding:12px 20px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;">
              Acessar Dashboard
            </a>
          </div>
        `;

        await transporter.sendMail({
          from: `"CoraEats Bot" <${process.env.SMTP_USER}>`,
          to: "coraeatssuporte@gmail.com",
          subject: `💰 Nova Venda Confirmada`,
          html,
        });

        console.log("E-mail enviado com sucesso.");
      } catch (emailError) {
        console.error("Erro ao enviar e-mail:", emailError);
      }
    } else {
      console.log("SMTP não configurado. E-mail ignorado.");
    }

    /* =====================================================
     * ATUALIZAÇÃO / CRIAÇÃO NO FIRESTORE
     * ===================================================== */
    const licensesRef = db.collection("licenses");

    const snapshot = await licensesRef
      .where("paymentId", "==", paymentId)
      .get();

    if (snapshot.empty) {
      // Nenhuma licença encontrada → notificação
      await db.collection("notifications").add({
        type: "sale_no_license",
        paymentId,
        customer,
        productName,
        amount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      console.log("Nenhuma licença encontrada. Notificação criada.");

      return res.status(200).json({
        received: true,
        status: "notification_created",
      });
    }

    /**
     * Atualiza licenças encontradas
     */
    const batch = db.batch();

    snapshot.forEach((doc) => {
      batch.update(doc.ref, {
        status: "paid",
        active: false, // ativa somente após contrato
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    console.log("Licença(s) atualizada(s) com sucesso.");

    return res.status(200).json({ received: true, status: "processed" });
  } catch (error) {
    console.error("Erro no Webhook:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
