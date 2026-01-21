import admin from "firebase-admin";
import nodemailer from "nodemailer";

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

  const { licenseId } = req.body;

  if (!licenseId) {
    return res.status(400).json({ error: "License ID required" });
  }

  try {
    const docRef = db.collection("licenses").doc(licenseId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Licença não encontrada" });
    }

    const data = docSnap.data();

    // 1. Atualizar Status no Firestore
    await docRef.update({
      status: "paid",
      active: false, // Mantém false até assinar contrato
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Enviar E-mail de Boas-vindas (se configurado)
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      data.clientContact
    ) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const baseUrl = `https://${req.headers.host}`;
      const statusUrl = `${baseUrl}/status.html?email=${encodeURIComponent(data.clientContact)}`;

      const clientHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #333;">
          <h2 style="color:#F47C2C;">Pagamento Aprovado! 🚀</h2>
          <p>Olá, <strong>${data.storeName || "Parceiro"}</strong>!</p>
          <p>Seu pagamento foi confirmado manualmente pela nossa equipe.</p>
          <p>Seu sistema já está sendo preparado. Para assinar o contrato e iniciar, clique abaixo:</p>
          <br />
          <div style="text-align: center; margin: 30px 0;">
            <a href="${statusUrl}"
              style="display:inline-block;padding:15px 25px;background:#10B981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
              Acessar Meu Painel
            </a>
          </div>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #999;">Atenciosamente,<br/>Equipe CoraEats</p>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: `"Equipe CoraEats" <${process.env.SMTP_USER}>`,
          to: data.clientContact,
          subject: `🎉 Pagamento Aprovado - CoraEats`,
          html: clientHtml,
        });
        console.log("E-mail de aprovação manual enviado.");
      } catch (emailErr) {
        console.error("Erro ao enviar email manual:", emailErr);
        // Não falha a requisição se só o email falhar, pois o banco já atualizou
      }
    }

    return res
      .status(200)
      .json({ success: true, message: "Pagamento aprovado e e-mail enviado." });
  } catch (error) {
    console.error("Erro ao aprovar pagamento:", error);
    return res.status(500).json({ error: error.message });
  }
}
