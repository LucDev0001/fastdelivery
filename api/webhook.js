import admin from "firebase-admin";
import nodemailer from "nodemailer";

/**
 * Configuração obrigatória para Webhook (Vercel)
 */
export const config = {
  api: {
    bodyParser: true,
  },
};

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const event = req.body;

  console.log("🔔 WEBHOOK RECEBIDO [FULL]:", JSON.stringify(event, null, 2));

  try {
    // DELAY DE SEGURANÇA: Aguarda 2 segundos para garantir que o Firestore
    // já indexou a licença criada pelo checkout (evita Race Condition)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    /**
     * Normalização do evento Abacate Pay
     */
    const eventType = event.event || event.type || null;
    const data = event.data || {};

    // Força maiúsculo para evitar erros de case (ex: "paid" vs "PAID")
    const status = (data.status || event.status || "").toUpperCase();

    const isPaid =
      status === "PAID" ||
      status === "COMPLETED" ||
      eventType === "billing.paid"; // Evento explícito de pagamento

    if (!isPaid) {
      console.log(`Evento ignorado. Status: ${status}, Tipo: ${eventType}`);
      return res.status(200).json({ received: true, ignored: true });
    }

    /**
     * Dados essenciais
     */
    // Tenta extrair o ID de diferentes locais possíveis no payload
    const paymentId = data.id || (data.bill && data.bill.id) || event.id;

    if (!paymentId) {
      console.error("❌ ERRO: paymentId não encontrado no payload do webhook.");
      return res.status(400).json({ error: "paymentId missing" });
    }

    const customer = data.customer || {};
    const products = data.products || [];
    const productName =
      products.length > 0 ? products[0].name : "Produto não identificado";

    const amount = data.amount || 0;
    const baseUrl = `https://${req.headers.host}`;
    let licenseKeyForEmail = null; // Variável para guardar a chave correta

    /* =====================================================
     * ATUALIZAÇÃO NO FIRESTORE (PRIORIDADE MÁXIMA)
     * ===================================================== */
    const licensesRef = db.collection("licenses");

    console.log(
      `🔎 Buscando licença no Firestore com paymentId: "${paymentId}"`,
    );

    let snapshot = await licensesRef.where("paymentId", "==", paymentId).get();

    // FALLBACK DE SEGURANÇA:
    // Se não achou pelo ID, tenta achar pela Chave da Licença (metadata)
    if (snapshot.empty && data.metadata && data.metadata.licenseKey) {
      console.log(
        `⚠️ ID não encontrado. Tentando buscar por licenseKey (Metadata): "${data.metadata.licenseKey}"`,
      );
      snapshot = await licensesRef
        .where("key", "==", data.metadata.licenseKey)
        .get();
    }

    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.forEach((doc) => {
        licenseKeyForEmail = doc.data().key; // Captura a chave existente
        batch.update(doc.ref, {
          status: "paid",
          active: false,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      console.log(
        `✅ SUCESSO: Licença(s) atualizada(s). Chave: ${licenseKeyForEmail}`,
      );
    } else {
      /* =====================================================
       * FALLBACK: CRIAÇÃO DE LICENÇA SE NÃO EXISTIR
       * ===================================================== */
      console.log(
        `⚠️ AVISO: Nenhuma licença encontrada. Criando licença de fallback...`,
      );

      // 1. Tenta usar a chave que veio do Checkout (Metadata) para manter consistência
      // Se não tiver, gera uma nova com prefixo CORA
      const key =
        (data.metadata && data.metadata.licenseKey) ||
        `CORA-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      // 2. Definir plano e validade
      let planType = "mensal";
      let daysToAdd = 30;

      if (productName.toLowerCase().includes("anual") || amount > 20000) {
        planType = "anual";
        daysToAdd = 365;
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + daysToAdd);

      licenseKeyForEmail = key; // Define a chave para o e-mail usar a mesma!

      // 3. Criar Licença no Firestore
      const newLicense = {
        storeName: customer.name || "Nova Loja (Pendente)",
        companyName: "",
        cnpj: customer.taxId || "",
        address: "",
        storeUrl: "",
        clientContact: customer.email || "",
        clientPhone: customer.phone || customer.cellphone || "",
        planType: planType,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        key: key,
        paymentId: paymentId,
        paymentLink: "",
        active: false,
        status: "paid", // Já nasce paga
        contractAccepted: false,
        setupStatus: "pending",
        autoCreated: true,
      };

      await db.collection("licenses").add(newLicense);
      console.log(`✅ FALLBACK: Licença criada com a chave ${key}`);
    }

    /* =====================================================
     * ENVIO DE EMAIL PARA ADMIN
     * ===================================================== */
    // Debug SMTP: Verifique nos logs da Vercel se as variáveis estão presentes
    console.log("Debug SMTP:", {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      hasPass: !!process.env.SMTP_PASS,
    });

    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      try {
        console.log("Enviando e-mail de notificação...");

        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2 style="color:#16a34a;">💰 Pagamento Confirmado</h2>
            <p><strong>Cliente:</strong> ${customer.name || "Não informado"}</p>
            <p><strong>Email:</strong> ${customer.email || "Não informado"}</p>
            <p><strong>Telefone:</strong> ${customer.phone || "Não informado"}</p>
            <hr />
            <p><strong>Produto:</strong> ${productName}</p>
            <p><strong>Valor:</strong> R$ ${(amount / 100).toFixed(2)}</p>
            <p><strong>ID Pagamento:</strong> ${paymentId}</p>
            <br />
            <a href="${baseUrl}/dashboard.html"
              style="display:inline-block;padding:12px 20px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;">
              Acessar Dashboard
            </a>
          </div>
        `;

        await transporter.sendMail({
          from: `"CoraEats Bot" <${process.env.SMTP_USER}>`,
          to: "coraeatssetup@gmail.com", // E-mail do Admin Atualizado
          subject: `💰 Nova Venda Confirmada`,
          html,
        });

        // --- NOVO: Envio de E-mail de Boas-vindas para o Cliente ---
        if (customer.email) {
          console.log(`Enviando e-mail de boas-vindas para: ${customer.email}`);

          // Usa a chave capturada ou tenta usar a do metadata se a variável estiver vazia
          const finalKey =
            licenseKeyForEmail || (data.metadata && data.metadata.licenseKey);
          const linkParams = finalKey
            ? `key=${finalKey}`
            : `email=${encodeURIComponent(customer.email)}`;

          const clientHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #333;">
              <h2 style="color:#F47C2C;">Bem-vindo ao CoraEats! 🚀</h2>
              <p>Olá, <strong>${customer.name || "Parceiro"}</strong>!</p>
              <p>Recebemos a confirmação do seu pagamento referente ao <strong>${productName}</strong>.</p>
              <p>Seu sistema já está sendo preparado. Clique abaixo para assinar seu contrato e liberar o acesso:</p>
              <br />
              <div style="text-align: center; margin: 30px 0;">
                <!-- Link corrigido para usar a KEY -->
                <a href="${baseUrl}/contrato.html?${linkParams}"
                  style="display:inline-block;padding:15px 25px;background:#10B981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
                  Assinar Contrato e Ativar
                </a>
              </div>
              <p style="text-align: center; font-size: 14px;"><a href="${baseUrl}/status.html?${linkParams}">Ou acompanhe o status aqui</a></p>
              <p>Se tiver qualquer dúvida, basta responder a este e-mail.</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #999;">Atenciosamente,<br/>Equipe CoraEats</p>
            </div>
          `;

          await transporter.sendMail({
            from: `"Equipe CoraEats" <${process.env.SMTP_USER}>`,
            to: customer.email,
            subject: `✅ Pagamento Confirmado - Próximos Passos`,
            html: clientHtml,
          });
        }

        console.log("E-mail enviado com sucesso.");
      } catch (emailError) {
        console.error("Erro ao enviar e-mail:", emailError);
      }
    } else {
      console.log("SMTP não configurado. E-mail ignorado.");
    }

    return res.status(200).json({ received: true, status: "processed" });
  } catch (error) {
    console.error("Erro no Webhook:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
