import admin from "firebase-admin";

// Inicializa o Firebase Admin (necessário para escrever no banco pelo backend)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const event = req.body;

  try {
    // Verifique na documentação do Abacate Pay qual o status de sucesso (ex: "PAID", "COMPLETED")
    if (event.status === "PAID" || event.event === "billing.paid") {
      const { customer, amount } = event.data;

      // Gera uma chave de licença única
      const key = `FAST-${Math.random()
        .toString(36)
        .substr(2, 4)
        .toUpperCase()}-${Math.random()
        .toString(36)
        .substr(2, 4)
        .toUpperCase()}-${Math.random()
        .toString(36)
        .substr(2, 4)
        .toUpperCase()}`;

      // Define validade
      // Se o valor for maior que R$ 500, assume anual (lógica simples)
      const isAnual = amount > 50000;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (isAnual ? 365 : 30));

      // Cria a licença no Firestore
      await db.collection("licenses").add({
        storeName: customer.name || "Nova Loja",
        clientContact: customer.email,
        cnpj: customer.taxId || "",
        planType: isAnual ? "anual" : "mensal",
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        key: key,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentId: event.id,
        storeUrl: "Aguardando configuração",
        contractAccepted: false,
      });

      // Aqui você poderia enviar um e-mail para o cliente com a chave (usando Resend, SendGrid, etc)
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erro Webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
