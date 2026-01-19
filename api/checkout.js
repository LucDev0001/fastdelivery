import axios from "axios";
import admin from "firebase-admin";

// Inicializa o Firebase Admin se necessário
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
    ),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  // Configuração de CORS (Permite acesso de qualquer origem para testes)
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  // Responde imediatamente a requisições OPTIONS (Preflight do navegador)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verifica se a chave da API está configurada
    if (!process.env.ABACATE_PAY_TOKEN) {
      throw new Error(
        "A chave ABACATE_PAY_TOKEN não está configurada nas Variáveis de Ambiente do Vercel.",
      );
    }

    const { plan, name, email, cpf, phone, key, domain } = req.body || {};

    // Sanitização (remove caracteres não numéricos para evitar erro na API)
    const cleanCpf = cpf ? cpf.replace(/\D/g, "") : "";
    const cleanPhone = phone ? phone.replace(/\D/g, "") : "";

    // Busca preços do Firestore
    let monthlyPrice = 9900;
    let annualPrice = 99000;
    try {
      const priceDoc = await db.collection("config").doc("pricing").get();
      if (priceDoc.exists) {
        const data = priceDoc.data();
        monthlyPrice = Math.round(data.monthly * 100);
        annualPrice = Math.round(data.annual * 100);
      }
    } catch (e) {
      console.error("Erro ao buscar preços, usando padrão", e);
    }

    const amount = plan === "anual" ? annualPrice : monthlyPrice;
    let title =
      plan === "anual" ? "CoraEats - Plano Anual" : "CoraEats - Plano Mensal";

    if (domain) title += ` (${domain})`;

    // URL base do seu site (Vercel preenche isso automaticamente)
    const baseUrl = `https://${req.headers.host}`;

    // Se vier uma chave (fluxo do Dashboard), retorna para o contrato
    // Se não (fluxo do site), retorna para a página de sucesso genérica
    let returnUrl = `${baseUrl}/sucesso.html?email=${encodeURIComponent(
      email,
    )}`;
    if (key) {
      returnUrl = `${baseUrl}/contrato.html?key=${key}`;
    }

    // CHAMADA PARA O ABACATE PAY
    // Consulte a documentação oficial do Abacate Pay para confirmar os campos exatos
    const response = await axios.post(
      "https://api.abacatepay.com/v1/billing/create",
      {
        frequency: "ONE_TIME", // Alterado para ONE_TIME para corrigir erro de validação (o controle de tempo é feito pela licença)
        methods: ["PIX"], // Métodos aceitos (CREDIT_CARD removido para corrigir erro de validação da API)
        products: [
          {
            externalId: plan,
            name: title,
            description: title,
            quantity: 1,
            price: amount,
          },
        ],
        returnUrl: returnUrl, // Página de retorno dinâmica
        completionUrl: returnUrl,
        webhookUrl: `${baseUrl}/api/webhook`, // Onde o Abacate avisa que pagou
        customer: {
          name: name,
          email: email,
          taxId: cleanCpf, // CPF/CNPJ
          phone: cleanPhone,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ABACATE_PAY_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    return res
      .status(200)
      .json({ url: response.data.url, id: response.data.id });
  } catch (error) {
    console.error("Erro API:", error.response?.data || error.message);
    const errorMessage =
      error.response?.data?.error ||
      error.message ||
      "Erro ao gerar pagamento.";
    return res.status(500).json({ error: errorMessage });
  }
}
