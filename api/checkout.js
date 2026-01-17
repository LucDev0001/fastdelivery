import axios from "axios";

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

    const { plan, name, email, cpf, phone, key } = req.body || {};

    // Sanitização (remove caracteres não numéricos para evitar erro na API)
    const cleanCpf = cpf ? cpf.replace(/\D/g, "") : "";
    const cleanPhone = phone ? phone.replace(/\D/g, "") : "";

    // Defina os valores em centavos (R$ 99,00 = 9900)
    const amount = plan === "anual" ? 99000 : 9900;
    const title =
      plan === "anual" ? "VouFood - Plano Anual" : "VouFood - Plano Mensal";

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
        frequency: plan === "anual" ? "YEARLY" : "MONTHLY", // Se for assinatura recorrente
        methods: ["PIX", "CREDIT_CARD"], // Métodos aceitos
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
