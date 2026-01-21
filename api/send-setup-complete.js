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
    const docSnap = await db.collection("licenses").doc(licenseId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: "License not found" });
    }

    const data = docSnap.data();

    if (!data.clientContact) {
      return res
        .status(400)
        .json({ error: "E-mail do cliente não encontrado." });
    }

    if (!data.storeUrl) {
      return res.status(400).json({
        error:
          "URL da loja não configurada. Preencha no dashboard antes de enviar.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const storeLink = data.storeUrl.startsWith("http")
      ? data.storeUrl
      : `https://${data.storeUrl}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #333;">
        <h2 style="color:#10B981;">🎉 Bem-vindo ao CoraEats!</h2>
        <p>Olá, <strong>${data.storeName || "Parceiro"}</strong>!</p>
        <p>É com grande alegria que informamos: <strong>Sua loja está pronta!</strong> A configuração do seu sistema foi concluída com sucesso.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
          <p style="margin-bottom: 10px; font-weight: bold;">Acesse sua loja agora:</p>
          <a href="${storeLink}" target="_blank" style="font-size: 18px; color: #2563eb; text-decoration: none; font-weight: bold;">${data.storeUrl}</a>
        </div>

        <p>Você já pode começar a divulgar seu link e receber pedidos!</p>
        <p>Se precisar de qualquer ajuste, nossa equipe de suporte está à disposição.</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999;">Atenciosamente,<br/>Equipe CoraEats</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Equipe CoraEats" <${process.env.SMTP_USER}>`,
      to: data.clientContact,
      subject: `🎉 Bem-vindo ao CoraEats! Sua loja está no ar.`,
      html,
    });

    return res
      .status(200)
      .json({ success: true, message: "E-mail de conclusão enviado!" });
  } catch (error) {
    console.error("Erro ao enviar e-mail de conclusão:", error);
    return res.status(500).json({ error: error.message });
  }
}
