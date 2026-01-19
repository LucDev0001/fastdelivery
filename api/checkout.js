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
  // Configuração de CORS (Permite acesso de qualquer origem)
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
        "A chave ABACATE_PAY_TOKEN não está configurada nas Variáveis de Ambiente da Vercel.",
      );
    }

    const { plan, name, email, cpf, phone, key, domain } = req.body || {};

    // Sanitização (remove caracteres não numéricos)
    const cleanCpf = cpf ? String(cpf).replace(/\D/g, "") : "";
    const cleanPhone = phone ? String(phone).replace(/\D/g, "") : "";

    // Validação básica para evitar erro na API externa
    if (!cleanPhone) {
      throw new Error("O telefone é obrigatório e deve conter números.");
    }
    if (!cleanCpf) {
      throw new Error("O CPF/CNPJ é obrigatório e deve conter números.");
    }

    // Busca preços do Firestore
    let monthlyPrice = 9900; // Valor padrão em centavos (R$ 99,00)
    let annualPrice = 99000; // Valor padrão em centavos (R$ 990,00)

    try {
      const priceDoc = await db.collection("config").doc("pricing").get();
      if (priceDoc.exists) {
        const data = priceDoc.data();
        // Garante que o valor seja inteiro (centavos)
        monthlyPrice = Math.round(data.monthly * 100);
        annualPrice = Math.round(data.annual * 100);
      }
    } catch (e) {
      console.error("Erro ao buscar preços, usando padrão:", e);
    }

    const amount = plan === "anual" ? annualPrice : monthlyPrice;
    let title =
      plan === "anual" ? "CoraEats - Plano Anual" : "CoraEats - Plano Mensal";

    if (domain) title += ` (${domain})`;

    // URL base do seu site
    const baseUrl = `https://${req.headers.host}`;

    // Lógica da URL de retorno
    // Se vier uma chave (fluxo do Dashboard), retorna para o contrato
    // Se não (fluxo do site), retorna para a página de sucesso genérica
    let returnUrl = `${baseUrl}/sucesso.html?email=${encodeURIComponent(
      email || "",
    )}`;
    if (key) {
      returnUrl = `${baseUrl}/contrato.html?key=${key}`;
    }

    // CHAMADA PARA O ABACATE PAY
    const response = await axios.post(
      "https://api.abacatepay.com/v1/billing/create",
      {
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
        returnUrl: returnUrl,
        completionUrl: returnUrl,
        webhookUrl: `${baseUrl}/api/webhook`,
        customer: {
          name: name || "Cliente",
          email: email,
          taxId: cleanCpf,
          cellphone: cleanPhone,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ABACATE_PAY_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    // Log para debug da resposta do Abacate Pay
    console.log("Resposta Abacate Pay:", JSON.stringify(response.data));

    // A API do Abacate Pay retorna os dados dentro de uma propriedade 'data'
    const responseData = response.data.data || response.data;

    if (response.data.error) {
      throw new Error(`Erro do Gateway: ${response.data.error}`);
    }

    if (!responseData || !responseData.url) {
      throw new Error(
        "URL de pagamento não encontrada na resposta do gateway.",
      );
    }

    return res.status(200).json({ url: responseData.url, id: responseData.id });
  } catch (error) {
    // Log detalhado para facilitar debug no painel da Vercel
    console.error("Erro API Checkout:", error.response?.data || error.message);

    const errorMessage =
      error.response?.data?.error ||
      error.message ||
      "Erro ao gerar pagamento.";

    return res.status(500).json({ error: errorMessage });
  }
}
