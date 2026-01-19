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
    const doc = await db.collection("licenses").doc(licenseId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "License not found" });
    }

    const data = doc.data();
    const { clientContact, storeName, key } = data;

    if (!clientContact) {
      return res
        .status(400)
        .json({ error: "Client email not found in license" });
    }

    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      return res.status(500).json({ error: "SMTP not configured" });
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

    const baseUrl = `https://${req.headers.host}`;
    const contractUrl = `${baseUrl}/contrato.html?key=${key}`;
    const statusUrl = `${baseUrl}/status.html?key=${key}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #10b981; margin: 0; font-size: 24px;">Bem-vindo ao CoraEats! 🚀</h1>
        </div>
        
        <div style="background-color: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="color: #374151; font-size: 16px;">Olá, <strong>${storeName}</strong>!</p>
          <p style="color: #374151; font-size: 16px;">Sua licença foi gerada com sucesso. Abaixo estão os links para ativar e acompanhar sua loja:</p>
          
          <div style="margin-top: 24px;">
            <p style="margin-bottom: 8px; font-weight: bold;">1. Assinar Contrato e Ativar:</p>
            <a href="${contractUrl}" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Acessar Contrato</a>
          </div>

          <div style="margin-top: 24px;">
            <p style="margin-bottom: 8px; font-weight: bold;">2. Acompanhar Instalação:</p>
            <a href="${statusUrl}" style="background-color: #f47c2c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver Status</a>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 24px; color: #9ca3af; font-size: 12px;">
          <p>Se tiver dúvidas, responda a este e-mail ou chame no WhatsApp.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"CoraEats Suporte" <${process.env.SMTP_USER}>`,
      to: clientContact,
      subject: "Bem-vindo ao CoraEats - Seus Links de Acesso",
      html,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    return res.status(500).json({ error: error.message });
  }
}
