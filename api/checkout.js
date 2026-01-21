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

        // Validação Mensal (Mínimo R$ 1,00 = 100 cents exigido pelo Abacate Pay)
        if (data.monthly) {
          const mVal = Math.round(Number(data.monthly) * 100);
          if (!isNaN(mVal) && mVal >= 100) monthlyPrice = mVal;
        }

        // Validação Anual
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

    /* ===========================
     * URLs
     * =========================== */
    const baseUrl = `https://${req.headers.host}`;

    // 1. Gera a chave AGORA (se não vier do dashboard)
    const licenseKey =
      key ||
      `CORA-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // 2. Passa a chave na URL de retorno para a página de sucesso pegar
    const completionUrl = `${baseUrl}/sucesso.html?email=${encodeURIComponent(email)}&key=${licenseKey}`;
    const returnUrl = `${baseUrl}/cancelado.html`; // Se cancelar, vai para a página personalizada

    /* ===========================
     * Payload Abacate Pay
     * =========================== */
    const payload = {
      frequency: "ONE_TIME",
      methods: ["PIX"],
      products: [
        {
          externalId: plan || "default",
          name: title,
          description: title,
          quantity: 1,
          price: amount,
        },
      ],
      metadata: {
        licenseKey: licenseKey, // SEGURANÇA: Envia a chave para recuperar no webhook
      },
      returnUrl: returnUrl,
      completionUrl: completionUrl,
      webhookUrl: `${baseUrl}/api/webhook`,
      customer: {
        name: name || "Cliente",
        email: email,
        taxId: cleanCpf,
        cellphone: cleanPhone,
      },
    };

    console.log("Payload enviado ao Abacate Pay:", payload);

    /* ===========================
     * Chamada API
     * =========================== */
    const response = await axios.post(
      "https://api.abacatepay.com/v1/billing/create",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.ABACATE_PAY_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(
      "Resposta Abacate Pay:",
      JSON.stringify(response.data, null, 2),
    );

    if (!response.data || response.data.success === false) {
      throw new Error(response.data?.error || "Erro ao criar cobrança.");
    }

    const responseData = response.data.data;

    if (!responseData?.url) {
      throw new Error("URL de pagamento não retornada.");
    }

    console.log(
      `✅ Checkout criado. Salvando licença com paymentId: "${responseData.id}"`,
    );

    /* ===========================
     * CRIAÇÃO DA LICENÇA (SEGURANÇA)
     * =========================== */
    // Cria a licença imediatamente como "Aguardando Pagamento"
    // Assim ela existe mesmo se o webhook falhar.
    let daysToAdd = 30;
    if (plan === "anual") daysToAdd = 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysToAdd);

    await db.collection("licenses").add({
      storeName: name || "Cliente Site",
      companyName: "",
      cnpj: cleanCpf,
      address: "",
      storeUrl: "",
      clientContact: email,
      clientPhone: cleanPhone,
      planType: plan || "mensal",
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      key: licenseKey,
      paymentId: responseData.id,
      paymentLink: responseData.url,
      active: false,
      status: "aguardando_pagamento",
      contractAccepted: false,
      setupStatus: "pending",
      autoCreated: true,
    });

    return res.status(200).json({
      url: responseData.url,
      id: responseData.id,
    });
  } catch (error) {
    console.error("Erro API Checkout:", error.response?.data || error.message);

    return res.status(500).json({
      error:
        error.response?.data?.error ||
        error.message ||
        "Erro interno no checkout.",
    });
  }
};
