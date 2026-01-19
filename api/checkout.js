import axios from "axios";
import admin from "firebase-admin";

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
        monthlyPrice = Math.round(Number(data.monthly) * 100);
        annualPrice = Math.round(Number(data.annual) * 100);
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

    let returnUrl = `${baseUrl}/sucesso.html?email=${encodeURIComponent(
      email,
    )}`;

    if (key) {
      returnUrl += `&key=${key}`;
    }

    /* ===========================
     * Payload Abacate Pay
     * =========================== */
    const payload = {
      frequency: "ONE_TIME",
      frequency: plan === "anual" ? "YEARLY" : "MONTHLY",
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
      returnUrl,
      completionUrl: returnUrl,
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
}
