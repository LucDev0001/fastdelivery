const axios = require("axios");
const admin = require("firebase-admin");

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

module.exports = async function handler(req, res) {
  /* ===========================
   * CORS
   * =========================== */
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* ===========================
     * Validação de ENV
     * =========================== */
    if (!process.env.ABACATE_PAY_TOKEN) {
      throw new Error("ABACATE_PAY_TOKEN não configurado.");
    }

    const { plan, name, email, cpf, phone, key, domain } = req.body || {};

    /* ===========================
     * Sanitização
     * =========================== */
    const cleanCpf = cpf ? String(cpf).replace(/\D/g, "") : "";
    let cleanPhone = phone ? String(phone).replace(/\D/g, "") : "";

    if (!email) {
      throw new Error("E-mail é obrigatório.");
    }

    if (!cleanPhone) {
      throw new Error("Telefone é obrigatório.");
    }

    if (!cleanCpf) {
      throw new Error("CPF/CNPJ é obrigatório.");
    }

    // Remove zero à esquerda se houver (ex: 021... -> 21...)
    if (cleanPhone.startsWith("0")) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Validação básica CPF/CNPJ
    if (cleanCpf.length !== 11 && cleanCpf.length !== 14) {
      throw new Error("CPF ou CNPJ inválido.");
    }

    // Garante DDI Brasil
    if (!cleanPhone.startsWith("55")) {
      cleanPhone = `55${cleanPhone}`;
    }

    /* ===========================
     * Preços
     * =========================== */
    let monthlyPrice = 9900; // R$ 99,00
    let annualPrice = 99000; // R$ 990,00

    try {
      const priceDoc = await db.collection("config").doc("pricing").get();
      if (priceDoc.exists) {
        const data = priceDoc.data();

        if (data.monthly) {
          const mVal = Math.round(Number(data.monthly) * 100);
          if (!isNaN(mVal) && mVal >= 100) monthlyPrice = mVal;
        }

        if (data.annual) {
          const aVal = Math.round(Number(data.annual) * 100);
          if (!isNaN(aVal) && aVal >= 100) annualPrice = aVal;
        }
      }
    } catch (err) {
      console.error("Erro ao buscar preços, usando padrão:", err);
    }

    const amount = plan === "anual" ? annualPrice : monthlyPrice;

    let title =
      plan === "anual" ? "CoraEats - Plano Anual" : "CoraEats - Plano Mensal";

    if (domain) {
      title += ` (${domain})`;
    }

    // 1. Gera a chave da licença
    const licenseKey =
      key ||
      `CORA-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    /* ===========================
     * CHECKOUT TRANSPARENTE (API V2)
     * =========================== */
    const transparentPayload = {
      method: "PIX",
      data: {
        amount: amount,
        description: title,
        externalId: licenseKey,
        metadata: {
          licenseKey: licenseKey,
        },
        customer: {
          name: name || "Cliente",
          email: email,
          cellphone: cleanPhone,
          taxId: cleanCpf,
        },
      },
    };

    console.log(
      "Chamando Checkout Transparente v2:",
      JSON.stringify(transparentPayload, null, 2),
    );

    const response = await axios.post(
      "https://api.abacatepay.com/v2/transparents/create",
      transparentPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.ABACATE_PAY_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(
      "Resposta Abacate Pay v2 Transparent:",
      JSON.stringify(response.data, null, 2),
    );

    if (!response.data || response.data.success === false) {
      throw new Error(
        response.data?.error || "Erro ao gerar PIX transparente no Abacate Pay.",
      );
    }

    const responseData = response.data.data;

    if (!responseData?.brCode && !responseData?.brCodeBase64) {
      throw new Error("Código PIX não retornado pela Abacate Pay.");
    }

    /* ===========================
     * CRIAÇÃO DA LICENÇA NO BANCO
     * =========================== */
    let daysToAdd = 30;
    if (plan === "anual") daysToAdd = 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysToAdd);

    await db.collection("licenses").add({
      storeName: name || "Cliente Site",
      companyName: "",
      cnpj: cleanCpf,
      address: "",
      storeUrl: domain || "",
      clientContact: email,
      clientPhone: cleanPhone,
      planType: plan || "mensal",
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      key: licenseKey,
      paymentId: responseData.id,
      paymentLink: responseData.url || "",
      pixCopiaECola: responseData.brCode || "",
      active: false,
      status: "aguardando_pagamento",
      contractAccepted: false,
      setupStatus: "pending",
      autoCreated: true,
    });

    return res.status(200).json({
      success: true,
      key: licenseKey,
      paymentId: responseData.id,
      pixCopiaECola: responseData.brCode,
      pixQrCode: responseData.brCodeBase64,
      amount: amount,
      url: responseData.url || null,
    });
  } catch (error) {
    console.error("Erro API Checkout Transparente:", error.response?.data || error.message);

    return res.status(500).json({
      error:
        error.response?.data?.error ||
        error.message ||
        "Erro interno no checkout transparente.",
    });
  }
};
