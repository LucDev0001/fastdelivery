<!DOCTYPE html>
<html lang="pt-BR">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Validar Licença do Sistema</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio"></script>
</head>

<body class="bg-gray-100 flex items-center justify-center min-h-screen">
    <div class="w-full max-w-lg bg-white p-8 rounded-lg shadow-md text-center">
        <h2 class="text-2xl font-bold text-gray-800 mb-2">Ativação do Sistema</h2>
        <p class="text-gray-600 mb-6">Por favor, insira a chave de licença fornecida para ativar seu sistema.</p>

        <div id="error-message" class="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm hidden"></div>

        <div class="space-y-4">
            <input type="text" id="license-key" placeholder="Ex: FAST-XXXX-XXXX-XXXX" class="w-full text-center uppercase px-4 py-3 border border-gray-300 rounded-lg text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500">
            <button id="validate-button" class="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition">Ativar Sistema</button>
        </div>
    </div>

    <script type="module">
        import {
            initializeApp
        } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
        import {
            getFirestore,
            collection,
            query,
            where,
            getDocs,
            updateDoc
        } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

        const firebaseConfig = {
            apiKey: "AIzaSyBJspCFmB7IQQdLdxLYQrZZ-TFAiDPXrXk",
            authDomain: "fastdelivery-46457.firebaseapp.com",
            projectId: "fastdelivery-46457",
            storageBucket: "fastdelivery-46457.appspot.com",
            messagingSenderId: "889884008498",
            appId: "1:889884008498:web:418e00c16326df6d4e1c2b"
        };

        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);
        const errorDiv = document.getElementById('error-message');

        document.getElementById('validate-button').addEventListener('click', async () => {
            const key = document.getElementById('license-key').value.trim().toUpperCase();
            if (!key) {
                showError('Por favor, insira uma chave.');
                return;
            }

            const q = query(collection(db, "licenses"), where("key", "==", key));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                showError('Chave de licença inválida ou não encontrada.');
                return;
            }

            let licenseData = null;
            let licenseDocRef = null;
            querySnapshot.forEach((doc) => {
                licenseData = doc.data();
                licenseDocRef = doc.ref;
            });

            // Validação 1: URL do site
            const currentUrl = window.location.origin;

            let licenseOrigin = licenseData.storeUrl || "";

            // TRAVA DE SEGURANÇA: Se a licença for coringa (*) ou vazia, vincula ao primeiro domínio que usar
            if (licenseOrigin === "" || licenseOrigin === "*") {
                try {
                    await updateDoc(licenseDocRef, {
                        storeUrl: currentUrl
                    });
                    licenseOrigin = currentUrl; // Atualiza a variável para validar imediatamente
                } catch (e) {
                    console.error("Aviso: Não foi possível vincular a licença ao domínio (verifique permissões).", e);
                }
            }

            // Se a URL for vazia ou "*", libera para qualquer domínio (Licença de Teste/Dev)
            if (licenseOrigin !== "" && licenseOrigin !== "*") {
                // Tenta extrair a origem da URL cadastrada na licença
                // Isso corrige o problema se o admin cadastrou a URL completa (com pastas)
                try {
                    if (licenseOrigin.includes('://')) {
                        licenseOrigin = new URL(licenseData.storeUrl).origin;
                    }
                } catch (e) {}

                if (licenseOrigin.replace(/\/$/, '') !== currentUrl.replace(/\/$/, '')) {
                    showError(`Licença inválida para este domínio.\nEsperado: ${licenseOrigin}\nAtual: ${currentUrl}`);
                    return;
                }
            }

            // Validação 2: Data de expiração
            const expiresDate = licenseData.expiresAt.toDate();
            if (expiresDate < new Date()) {
                showError('Esta licença expirou. Por favor, contate o suporte.');
                return;
            }

            // Tenta salvar no banco de dados local (PHP) se disponível
            try {
                const formData = new FormData();
                formData.append('key', key);
                formData.append('expires_at', expiresDate.toISOString().slice(0, 10));

                const phpResponse = await fetch('ativar_licenca.php', {
                    method: 'POST',
                    body: formData
                });
                const responseText = await phpResponse.text();

                try {
                    const data = JSON.parse(responseText);
                    if (!data.success) {
                        console.warn("Aviso do PHP:", data.message);
                    }
                } catch (jsonError) {
                    console.log("O backend não retornou JSON (provavelmente ambiente estático/Vercel). Ignorando salvamento local.");
                }
            } catch (e) {
                console.log("Erro de conexão com ativar_licenca.php (ignorado):", e);
            }

            alert("Licença validada e ativada com sucesso!");
            window.location.href = 'index.php';
        });

        function showError(message) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }
    </script>
</body>

</html>