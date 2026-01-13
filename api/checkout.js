import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, name, email, cpf, phone, key } = req.body;

  // Defina os valores em centavos (R$ 99,00 = 9900)
  const amount = plan === "anual" ? 99000 : 9900;
  const title =
    plan === "anual"
      ? "FastDelivery - Plano Anual"
      : "FastDelivery - Plano Mensal";

  // URL base do seu site (Vercel preenche isso automaticamente)
  const baseUrl = `https://${req.headers.host}`;

  // Se vier uma chave (fluxo do Dashboard), retorna para o contrato
  // Se não (fluxo do site), retorna para a página de sucesso genérica
  let returnUrl = `${baseUrl}/sucesso.html?email=${encodeURIComponent(email)}`;
  if (key) {
    returnUrl = `${baseUrl}/contrato.html?key=${key}`;
  }

  try {
    // CHAMADA PARA O ABACATE PAY
    // Consulte a documentação oficial do Abacate Pay para confirmar os campos exatos
    const response = await axios.post(
      "https://api.abacatepay.com/v1/billing/create",
      {
        amount: amount,
        customer: {
          name: name,
          email: email,
          taxId: cpf, // CPF/CNPJ
          phone: phone,
        },
        description: title,
        frequency: plan === "anual" ? "YEARLY" : "MONTHLY", // Se for assinatura recorrente
        methods: ["PIX", "CREDIT_CARD"], // Métodos aceitos
        returnUrl: returnUrl, // Página de retorno dinâmica
        webhookUrl: `${baseUrl}/api/webhook`, // Onde o Abacate avisa que pagou
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ABACATE_PAY_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res
      .status(200)
      .json({ url: response.data.url, id: response.data.id });
  } catch (error) {
    console.error("Erro Abacate Pay:", error.response?.data || error.message);
    return res.status(500).json({ error: "Erro ao gerar pagamento." });
  }
}
