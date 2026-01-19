<?php
// Habilitar exibição de erros para debug
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

session_start();
include 'admin/conexao.php';

// Verifica se o cliente está logado
$clienteLogado = isset($_SESSION['cliente_id']);
$cliente = null;
$status_pedido = null;
$produtos_recomendados = [];
$cat_produtos = [];

$taxaEntregaCalculada = 0;
$entregaDisponivel = false;

if ($clienteLogado) {
    $cliente_id = intval($_SESSION['cliente_id']);
    $cliente = $conn->query("SELECT * FROM clientes WHERE id = $cliente_id")->fetch_assoc();

    // Se o cliente não for encontrado (ex: foi deletado), faz logout forçado para evitar erro
    if (!$cliente) {
        session_destroy();
        header("Location: index.php");
        exit;
    }

    // --- MIGRAÇÃO AUTOMÁTICA: Se não tiver endereços na tabela nova, cria com o atual ---
    $checkEnd = $conn->query("SELECT id FROM enderecos_cliente WHERE cliente_id = $cliente_id LIMIT 1");
    if ($checkEnd && $checkEnd->num_rows == 0 && !empty($cliente['rua'])) {
        $stmtMigra = $conn->prepare("INSERT INTO enderecos_cliente (cliente_id, apelido, rua, numero, complemento, bairro, cep, referencia, lat, lng, selecionado) VALUES (?, 'Principal', ?, ?, ?, ?, ?, ?, ?, ?, 1)");
        $stmtMigra->bind_param("issssssss", $cliente_id, $cliente['rua'], $cliente['numero'], $cliente['complemento'], $cliente['bairro'], $cliente['cep'], $cliente['referencia'], $cliente['lat'], $cliente['lng']);
        $stmtMigra->execute();
    }

    // --- CARREGA ENDEREÇO SELECIONADO ---
    $resEndSel = $conn->query("SELECT * FROM enderecos_cliente WHERE cliente_id = $cliente_id AND selecionado = 1");
    $endSel = $resEndSel ? $resEndSel->fetch_assoc() : null;

    if ($endSel) {
        // Sobrescreve dados na memória para cálculo de taxa
        $cliente['rua'] = $endSel['rua'];
        $cliente['numero'] = $endSel['numero'];
        $cliente['bairro'] = $endSel['bairro'];
        $cliente['lat'] = $endSel['lat'];
        $cliente['lng'] = $endSel['lng'];
    }

    // Calcula taxa baseada na localização do cliente
    $zona = verificarZonaEntrega($conn, $cliente['lat'], $cliente['lng'], $cliente['bairro']);
    if ($zona) {
        $taxaEntregaCalculada = floatval($zona['valor']);
        $entregaDisponivel = true;
    }

    // Pega o último pedido
    $ultimoPedido = $conn->query("SELECT status FROM pedidos WHERE cliente_id = $cliente_id ORDER BY data_pedido DESC LIMIT 1");
    if ($ultimoPedido && $ultimoPedido->num_rows > 0) {
        $pedido = $ultimoPedido->fetch_assoc();
        $status_pedido = $pedido['status'];
    }
}

// Buscar anúncios ativos
$anuncios = $conn->query("SELECT * FROM anuncios WHERE ativo = 1 ORDER BY id DESC");



$cat_produtos = [];

// Busca todas as categorias cadastradas no banco de dados
$resCategorias = $conn->query("SELECT * FROM categorias ORDER BY id ASC");

if ($resCategorias) {
    while ($categoria = $resCategorias->fetch_assoc()) {
        $cat_id = $categoria['id'];
        $nomeCategoria = $categoria['nome'];
        $produtos = $conn->query("SELECT * FROM produtos WHERE categoria_id = $cat_id AND visivel = 1 ORDER BY nome ASC");

        if ($produtos && $produtos->num_rows > 0) {
            $cat_produtos[$nomeCategoria] = $produtos;
        }
    }
}



// Loja aberta?
$statusLoja = $conn->query("SELECT valor FROM configuracoes WHERE chave = 'loja_aberta'")->fetch_assoc()['valor'] ?? '0';
$lojaAberta = $statusLoja == '1';


?>


<!DOCTYPE html>
<html lang="pt-BR">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <!-- SEO básico -->
    <title>CoraEats | Delivery</title>
    <meta name="description"
        content="Peça online no Vou Food! Hambúrgueres artesanais, combos, acompanhamentos e bebidas com entrega rápida no Rio de Janeiro. Acesse nosso cardápio agora!">
    <link rel="canonical" href="">
    <meta name="robots" content="index, follow">

    <!-- Open Graph (Facebook, Instagram, WhatsApp) -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="CoraEats 🍔 | Delivery de Hambúrguer Artesanal">
    <meta property="og:description" content="Peça já o seu lanche no Vou Food! Delivery rápido e saboroso.">
    <meta property="og:image" content="https://seulink/imagens/logoloja.jpg">
    <meta property="og:url" content="https://seulink/">
    <meta property="og:site_name" content="CoraEats">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="CoraEats 🍔 | Delivery de Hambúrguer Artesanal">
    <meta name="twitter:description" content="Seu lanche favorito entregue rapidamente!">
    <meta name="twitter:image" content="https://seulink/imagens/logoloja.jpg">

    <!-- Favicon -->
    <link rel="shortcut icon" href="imagens/favicon.ico" type="image/x-icon">

    <!-- Preconnect para otimizar carregamento de fontes -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

    <!-- Bootstrap e SweetAlert -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

    <!-- Seu CSS -->
    <link rel="stylesheet" href="assets/css/index_cliente.css">

    <!-- JSON-LD para Schema Markup (Google entender que é um Restaurante) -->
    <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Restaurant",
            "name": "CoraEats",
            "image": "https://seulink/imagens/logoloja.jpg",
            "url": "https://seulink/",
            "telephone": "+55 21 98385-6779",
            "servesCuisine": "Hambúrguer, Fast Food",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": "Rio de Janeiro",
                "addressRegion": "RJ",
                "addressCountry": "BR"
            }
        }
    </script>

    <!-- Web App Manifest -->
    <link rel="manifest" href="./manifest.json">

    <!-- Cor para a barra do navegador no celular -->
    <meta name="theme-color" content="#0F1C2E">



    <!-- Web App para Android/Chrome -->
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="application-name" content="CoraEats">

    <!-- Web App para iOS/Safari -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="CoraEats">
    <link rel="icon" href="imagens/icon-192.png">
    <link rel="apple-touch-icon" href="imagens/icon-512.png">







    <style>
        :root {
            --primary-blue: #0F1C2E;
            --accent-orange: #F47C2C;
        }

        .text-danger {
            color: var(--primary-blue) !important;
        }

        .btn-danger {
            background-color: var(--accent-orange) !important;
            border-color: var(--accent-orange) !important;
        }

        .btn-danger:hover {
            background-color: #e06b20 !important;
        }

        .btn-outline-danger {
            color: var(--accent-orange) !important;
            border-color: var(--accent-orange) !important;
        }

        .btn-outline-danger:hover {
            background-color: var(--accent-orange) !important;
            color: white !important;
        }

        .badge-notificacao {
            background-color: var(--accent-orange) !important;
        }

        .nav-item.active {
            color: var(--accent-orange) !important;
        }

        @keyframes pulseAviso {
            0% {
                transform: scale(1);
                box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7);
            }

            70% {
                transform: scale(1.05);
                box-shadow: 0 0 0 10px rgba(229, 57, 53, 0);
            }

            100% {
                transform: scale(1);
                box-shadow: 0 0 0 0 rgba(229, 57, 53, 0);
            }
        }

        #aviso-status-pedido {
            animation: pulseAviso 1.5s infinite;
        }

        .topo-capa-ifood {
            background: url('imagens/capa.jpg') center center / cover no-repeat;
            height: 200px;
            position: relative;
        }

        .card-topo-ifood {
            background: white;
            border-radius: 20px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
            padding: 15px 20px 10px;
            width: 90%;
            max-width: 500px;
            margin: 0 auto;
            margin-top: -40px;
            margin-bottom: 20px;
            position: relative;
            text-align: center;
            z-index: 2;
        }

        .logo-circular-ifood {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            border: 3px solid white;
            object-fit: cover;
            position: absolute;
            top: -35px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
        }

        .status-aberta {
            color: green;
            font-weight: 600;
        }

        .status-fechada {
            color: gray;
            font-weight: 600;
        }

        .topo-capa-ifood-container {
            margin-bottom: 60px;
        }
    </style>



</head>

<body>

    <div class="topo-capa-ifood"></div>

    <div class="card-topo-ifood">
        <img src="imagens/logoloja.jpg" class="logo-circular-ifood" alt="Logo Vou Food">
        <h5 class="mt-3 mb-1">CoraEats<?= $cliente ? ' - ' . htmlspecialchars($cliente['nome']) : '' ?></h5>

        <!-- SELEÇÃO DE ENDEREÇO -->
        <?php if ($clienteLogado): ?>
            <div class="d-flex align-items-center justify-content-center gap-2 mt-2 p-2 rounded hover-bg-gray" onclick="abrirModalEnderecos()" style="cursor: pointer; background: #f8f9fa;">
                <div class="text-truncate" style="max-width: 250px; font-size: 0.9rem; color: #333;">
                    <span class="text-danger me-1"><i class="fas fa-map-marker-alt"></i></span>
                    <?= !empty($cliente['rua']) ? htmlspecialchars($cliente['rua'] . ', ' . $cliente['numero']) : 'Selecione um endereço' ?>
                    <i class="fas fa-chevron-down ms-1 text-muted" style="font-size: 0.7rem;"></i>
                </div>
            </div>
            <?php if ($clienteLogado): ?>
                <div class="text-muted mt-1" style="font-size: 0.85rem;">🛵 Taxa: R$ <?= number_format($taxaEntregaCalculada, 2, ',', '.') ?> <?php if (isset($zona['tempo_estimado'])) echo "• " . $zona['tempo_estimado']; ?></div>
            <?php endif; ?>
            <?php if ($clienteLogado && $taxaEntregaCalculada == 0 && !$entregaDisponivel): ?>
                <div class="text-danger mt-1" style="font-size: 0.8rem; font-weight: bold;">⚠️ Endereço não localizado no mapa. <br> Clique acima para ajustar.</div>
            <?php endif; ?>
        <?php else: ?>
            <div style="font-size: 0.9rem;" class="text-muted mt-2">
                🛵 Entrega disponível
            </div>
        <?php endif; ?>

        <div class="mt-1 <?= $lojaAberta ? 'status-aberta' : 'status-fechada' ?>">
            <?= $lojaAberta ? 'Loja Aberta' : 'Loja Fechada' ?>
        </div>

        <?php if ($status_pedido && $status_pedido !== 'entregue'): ?>
            <div id="aviso-status-pedido" onclick="irParaPedidos()"
                style="background:#F47C2C; color:white; padding:4px 8px; border-radius:15px; font-size:0.85rem; cursor:pointer; display:inline-block; margin-top:6px;">
                📦 Pedido em andamento
            </div>
        <?php endif; ?>
    </div>


    <div class="categoria-scroll bg-white py-2 px-3 sticky-top"
        style="overflow-x: auto; white-space: nowrap; z-index: 1020;">
        <?php foreach ($cat_produtos as $nome => $_): ?>
            <a href="#<?= strtolower(preg_replace('/[^a-z0-9]/', '-', $nome)) ?>" class="categoria-link me-2 mb-1">
                <?= htmlspecialchars($nome) ?>
            </a>
        <?php endforeach; ?>
    </div>


    <div id="barra-busca" class="bg-white shadow-sm py-2 px-3 d-none position-sticky top-0 z-3">
        <div class="input-group">
            <input type="text" id="campo-busca" class="form-control" placeholder="Buscar no cardápio..."
                oninput="filtrarCardapio()">
            <button class="btn btn-outline-danger" onclick="fecharBusca()"><i class="fas fa-times"></i></button>
        </div>
    </div>


    <div id="aviso-status-pedido" onclick="irParaPedidos()"
        style="display:none; position:fixed; bottom:130px; right:20px; background:#F47C2C; color:white; padding:10px 15px; border-radius:20px; font-size:14px; cursor:pointer; z-index:9999; box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        📦 Pedido em andamento
    </div>


    <div>
        <?php if ($anuncios && $anuncios->num_rows > 0): ?>
            <div id="anunciosCarousel" class="carousel slide mb-4 rounded" data-bs-ride="carousel" style="padding: 10px;">
                <div class="carousel-inner" style="border-radius: 10px;">
                    <?php
                    $ativo = true;
                    while ($anuncio = $anuncios->fetch_assoc()):
                    ?>
                        <div class="carousel-item <?= $ativo ? 'active' : '' ?>">
                            <div class="position-relative overflow-hidden">
                                <img src="<?= htmlspecialchars($anuncio['imagem']) ?>" class="d-block w-100"
                                    style="max-height:200px; object-fit:cover; border: 10px;" alt="Anúncio">


                                <div class="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center"
                                    style="background: rgba(0,0,0,0.5);">
                                    <h2 class="text-white fw-bold text-center px-3 text-shadow mb-3" style="font-size: 2rem;">
                                        <?= htmlspecialchars($anuncio['titulo']) ?>
                                    </h2>
                                    <?php if (!empty($anuncio['produto_id'])): ?>
                                        <button class="btn btn-danger fw-bold px-4"
                                            onclick="adicionarAnuncioAoCarrinho(<?= $anuncio['produto_id'] ?>)"
                                            data-anuncio-id="<?= $anuncio['id'] ?>">
                                            🍔 Pedir agora
                                        </button>
                                    <?php endif; ?>

                                </div>
                            </div>
                        </div>
                    <?php
                        $ativo = false;
                    endwhile;
                    ?>
                </div>

                <?php if ($anuncios->num_rows > 1): ?>
                    <button class="carousel-control-prev" type="button" data-bs-target="#anunciosCarousel" data-bs-slide="prev">
                        <span class="carousel-control-prev-icon"></span>
                    </button>
                    <button class="carousel-control-next" type="button" data-bs-target="#anunciosCarousel" data-bs-slide="next">
                        <span class="carousel-control-next-icon"></span>
                    </button>
                <?php endif; ?>
            </div>
        <?php endif; ?>



    </div>






    <main class="container py-4">
        <?php foreach ($cat_produtos as $categoria => $produtos): ?>
            <div class="secao mb-4" id="<?= strtolower(preg_replace('/[^a-z0-9]/', '-', $categoria)) ?>">
                <h4 class="text-danger fw-bold mb-3">🍔 <?= htmlspecialchars($categoria) ?></h4>

                <div class="row g-3">
                    <?php while ($p = $produtos->fetch_assoc()): ?>
                        <div class="col-md-6">
                            <div class="produto-card d-flex p-3 border rounded shadow-sm bg-white align-items-start">
                                <div class="me-3 flex-grow-1">
                                    <h5><?= htmlspecialchars($p['nome']) ?></h5>
                                    <p class="small text-muted mb-1"><?= htmlspecialchars($p['descricao']) ?></p>
                                    <div class="d-flex justify-content-between align-items-center">
                                        <strong class="text-success">R$ <?= number_format($p['preco'], 2, ',', '.') ?></strong>
                                        <button class="btn btn-danger btn-sm add-carrinho" onclick="adicionarProduto(this)"
                                            data-id="<?= $p['id'] ?>" data-nome="<?= htmlspecialchars($p['nome']) ?>"
                                            data-preco="<?= $p['preco'] ?>">
                                            +
                                        </button>

                                    </div>
                                </div>
                                <?php if (!empty($p['imagem'])): ?>
                                    <img src="admin/imagens/<?= $p['imagem'] ?>" class="rounded img-produto-click"
                                        style="width: 90px; height: 90px; object-fit: cover; cursor: pointer;"
                                        onclick="abrirImagemProduto(this)">

                                <?php endif; ?>
                            </div>
                        </div>
                    <?php endwhile; ?>
                </div>
            </div>
        <?php endforeach; ?>
    </main>

    <div class="barra-sacola" id="barraSacola">
        <img src="imagens/logoloja.jpg" alt="Logo Vou Food">
        <div class="info">
            <small>Total sem entrega</small><br>
            <strong id="total-sacola">R$ 0,00</strong> / <span id="itens-sacola">0 itens</span>
        </div>
        <button class="btn-sacola" onclick="abrirCarrinho()">Ver sacola</button>
    </div>

    <!-- Modal de Complementos Novo Estilo -->
    <div id="modalComplementos" class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-fullscreen-sm-down">
            <div class="modal-content">
                <div class="modal-header d-flex justify-content-between align-items-center">
                    <button type="button" class="btn btn-link text-danger" onclick="fecharComplementos()">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <h5 class="modal-title text-center" id="tituloProduto">Produto</h5>
                    <button type="button" class="btn btn-link text-danger" onclick="limparComplementos()">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>

                <div class="modal-body" id="corpoComplementos">
                    <p>Carregando opções...</p>
                </div>

                <div class="modal-footer d-flex justify-content-between align-items-center">

                    <button type="button" class="btn btn-danger flex-grow-1" onclick="adicionarAoCarrinho()">
                        Adicionar à Sacola
                    </button>

                </div>
            </div>
        </div>
    </div>

    <!-- Modal de Visualização de Imagem -->
    <div id="modalImagemProduto" class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-transparent border-0">
                <div class="modal-body text-center position-relative p-0">
                    <button type="button" class="btn-close position-absolute top-0 end-0 m-3" data-bs-dismiss="modal"
                        aria-label="Fechar" style="filter: brightness(0) invert(1);">
                    </button>

                    <img id="imagemModalProduto" src="" alt="Imagem do produto" class="img-fluid rounded shadow">
                </div>
            </div>
        </div>
    </div>

    <nav class="barra-inferior">
        <a href="index.php" class="nav-item active">
            <i class="fas fa-home"></i>
            <span>Início</span>
        </a>
        <a href="#" class="nav-item" onclick="abrirBusca()">
            <i class="fas fa-search"></i>
            <span>Busca</span>
        </a>
        <a href="cliente/pedidos.php" class="nav-item">
            <i class="fas fa-receipt"></i>
            <span>Pedidos</span>
        </a>
        <a href="cliente/perfil.php" class="nav-item position-relative">
            <i class="fas fa-user"></i>
            <span>Perfil</span>
            <?php if ($cliente): ?>
                <span class="badge-notificacao"></span>
            <?php endif; ?>
        </a>
    </nav>




    <script>
        const clienteLogado = <?= json_encode($clienteLogado) ?>;
        const taxaEntregaCalculada = <?= json_encode($taxaEntregaCalculada) ?>;
        const entregaDisponivel = <?= json_encode($entregaDisponivel) ?>;

        // --- LÓGICA DE ENDEREÇOS ---
        function abrirModalEnderecos() {
            if (!clienteLogado) {
                Swal.fire('Faça Login', 'Você precisa entrar para gerenciar endereços.', 'info');
                return;
            }
            window.location.href = 'cliente/selecionar_endereco.php';
        }

        function abrirBusca() {
            document.getElementById("barra-busca").classList.remove("d-none");
            document.getElementById("campo-busca").focus();
        }

        function fecharBusca() {
            document.getElementById("barra-busca").classList.add("d-none");
            document.getElementById("campo-busca").value = "";
            filtrarCardapio(); // limpa o filtro
        }




        function filtrarCardapio() {
            const termo = document.getElementById("campo-busca").value.toLowerCase();
            const produtos = document.querySelectorAll(".produto-card");

            produtos.forEach(p => {
                const nome = p.querySelector("h5")?.textContent.toLowerCase();
                const desc = p.querySelector("p")?.textContent.toLowerCase();
                const visivel = nome.includes(termo) || desc.includes(termo);
                p.closest(".col-md-6").style.display = visivel ? "" : "none";
            });
        }

        // Carregar carrinho do localStorage no início da página
        let carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];
        let produtoAtual = null; // usado no modal para armazenar o produto clicado


        function adicionarProduto(botao) {


            const id = botao.getAttribute('data-id');
            const nome = botao.getAttribute('data-nome');
            const preco = parseFloat(botao.getAttribute('data-preco'));

            fetch('admin/buscar_complementos.php?id=' + id)
                .then(response => response.json())
                .then(dados => {

                    console.log("Dados complementos:", dados);

                    if (dados.length > 0) {
                        abrirModalComplementos(id, nome, preco, dados);
                    } else {
                        adicionarAoCarrinhoDireto(nome, preco);
                    }
                })
                .catch(error => {
                    console.error('Erro ao buscar complementos:', error);
                    adicionarAoCarrinhoDireto(nome, preco);
                });
        }


        function abrirImagemProduto(img) {
            const src = img.getAttribute('src');
            document.getElementById('imagemModalProduto').setAttribute('src', src);
            new bootstrap.Modal(document.getElementById('modalImagemProduto')).show();
        }






        function abrirModalComplementos(id, nome, preco, grupos) {
            document.querySelector('.barra-inferior').style.display = 'none';

            produtoAtual = {
                id,
                nome,
                preco,
                grupos,
                complementosSelecionados: {}
            };

            let html = '';

            grupos.forEach((grupo, index) => {
                html += `<h6 class="text-danger mt-3">${grupo.nome_grupo}</h6>`;

                grupo.itens.forEach(item => {
                    let precoAdicional = item.preco_adicional ? parseFloat(item.preco_adicional) : 0;
                    let labelItem = precoAdicional > 0 ? `${item.nome} (+ R$${precoAdicional.toFixed(2)})` : item.nome;

                    html += `
      <div class="d-flex align-items-center justify-content-between mb-2">
        <span>${labelItem}</span>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="alterarQtdComplemento(${index}, '${item.nome}', -1)">-</button>
          <span id="qtd_${index}_${item.nome.replace(/\s+/g, '_')}">0</span>
          <button type="button" class="btn btn-sm btn-outline-success" onclick="alterarQtdComplemento(${index}, '${item.nome}', 1)">+</button>
        </div>
      </div>`;
                });
            });

            document.getElementById('corpoComplementos').innerHTML = html;
            document.getElementById('tituloProduto').innerText = nome;
            document.querySelector('.barra-inferior').style.display = 'none';


            new bootstrap.Modal(document.getElementById('modalComplementos')).show();
        }

        function alterarQtdComplemento(grupoIndex, itemNome, delta) {
            const grupo = produtoAtual.grupos[grupoIndex];
            const itemKey = itemNome.replace(/\s+/g, '_');

            if (!produtoAtual.complementosSelecionados[grupoIndex]) {
                produtoAtual.complementosSelecionados[grupoIndex] = {};
            }

            const atual = produtoAtual.complementosSelecionados[grupoIndex][itemNome] || 0;
            let novo = atual + delta;

            const totalGrupo = Object.values(produtoAtual.complementosSelecionados[grupoIndex]).reduce((acc, qtd) => acc + qtd, 0) + (delta > 0 ? 1 : -1);

            if (novo < 0) novo = 0;
            if (grupo.maximo > 0 && totalGrupo > grupo.maximo) return alert(`Máximo permitido: ${grupo.maximo} itens.`);

            produtoAtual.complementosSelecionados[grupoIndex][itemNome] = novo;
            document.getElementById(`qtd_${grupoIndex}_${itemKey}`).textContent = novo;

            validarComplementos();
        }

        function validarComplementos() {
            let tudoOk = true;

            produtoAtual.grupos.forEach((grupo, index) => {
                if (grupo.obrigatorio) {
                    const selecionados = produtoAtual.complementosSelecionados[index] || {};
                    const totalSelecionados = Object.values(selecionados).reduce((acc, qtd) => acc + qtd, 0);

                    if (totalSelecionados < grupo.minimo) {
                        tudoOk = false;
                    }
                }
            });

            document.querySelector("#modalComplementos .btn-danger").disabled = !tudoOk;
        }

        function fecharComplementos() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalComplementos'));
            if (modal) {
                modal.hide();
            }
        }


        function adicionarAoCarrinho() {
            // Validação de mínimo
            for (let grupoIndex in produtoAtual.grupos) {
                const grupo = produtoAtual.grupos[grupoIndex];
                const selecionados = produtoAtual.complementosSelecionados[grupoIndex] || {};
                const totalSelecionados = Object.values(selecionados).reduce((acc, qtd) => acc + qtd, 0);

                if (grupo.obrigatorio && totalSelecionados < grupo.minimo) {
                    alert(`Selecione no mínimo ${grupo.minimo} itens em "${grupo.nome_grupo}".`);
                    return;
                }
            }

            const descricao = produtoAtual.nome + gerarDescricaoComplementos();
            const precoFinal = calcularPrecoTotal();

            carrinho.push({
                nome: descricao,
                preco: precoFinal,
                qtd: 1
            });
            atualizarCarrinho();

            bootstrap.Modal.getInstance(document.getElementById('modalComplementos')).hide();
        }

        function adicionarAnuncioAoCarrinho(produtoId) {


            fetch('admin/buscar_produto.php?id=' + produtoId)
                .then(response => response.json())
                .then(produto => {
                    if (produto) {
                        // Cria botão virtual com os atributos esperados
                        const fakeBtn = document.createElement('button');
                        fakeBtn.setAttribute('data-id', produto.id);
                        fakeBtn.setAttribute('data-nome', produto.nome);
                        fakeBtn.setAttribute('data-preco', produto.preco);
                        adicionarProduto(fakeBtn);
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: 'Erro',
                            text: 'Produto não encontrado.'
                        });
                    }
                })
                .catch(error => {
                    console.error('Erro ao buscar produto:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Erro',
                        text: 'Erro ao buscar produto.'
                    });
                });
        }


        function limparCarrinho() {
            if (confirm("Tem certeza que deseja limpar sua sacola?")) {
                carrinho = [];
                atualizarCarrinho();
                fecharCarrinho(); // opcional: fecha o modal depois de limpar
                document.getElementById("barraSacola").style.display = "none";
                document.getElementById("iconeSacola").style.display = "none";
            }
        }



        function gerarDescricaoComplementos() {
            let descricao = '';

            for (let grupoIndex in produtoAtual.grupos) {
                const grupo = produtoAtual.grupos[grupoIndex];
                const selecionados = produtoAtual.complementosSelecionados[grupoIndex];

                if (selecionados) {
                    const itensSelecionados = [];

                    for (let nome in selecionados) {
                        if (selecionados[nome] > 0) {
                            itensSelecionados.push(`${nome} x${selecionados[nome]}`);
                        }
                    }

                    if (itensSelecionados.length) {
                        descricao += `\n- ${grupo.nome_grupo}: ${itensSelecionados.join(', ')}`;
                    }
                }
            }

            return descricao;
        }

        function atualizarCarrinho() {

            // Se carrinho não estiver definido ainda (ex: recarregou página), recupera do localStorage
            if (typeof carrinho === 'undefined' || !Array.isArray(carrinho)) {
                carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];
            }

            const totalSacola = document.getElementById("total-sacola");
            const itensSacola = document.getElementById("itens-sacola");
            const barraSacola = document.getElementById("barraSacola");
            const iconeSacola = document.getElementById("iconeSacola");

            let soma = 0;
            let totalItens = 0;

            carrinho.forEach(item => {
                soma += item.preco * item.qtd;
                totalItens += item.qtd;
            });

            totalSacola.textContent = 'R$ ' + soma.toFixed(2);
            itensSacola.textContent = `${totalItens} item${totalItens !== 1 ? 's' : ''}`;

            if (totalItens > 0) {
                barraSacola.style.display = 'flex';
                iconeSacola.style.display = 'none';
            } else {
                barraSacola.style.display = 'none';
                iconeSacola.style.display = 'none';
            }

            // Salva carrinho no localStorage
            localStorage.setItem('carrinho', JSON.stringify(carrinho));
        }

        function abrirCarrinho() {
            window.location.href = 'carrinho.php';
        }

        document.addEventListener("DOMContentLoaded", () => {
            document.getElementById("barraSacola").style.display = "none";
            atualizarCarrinho(); // Garante que o carrinho apareça correto ao carregar a página
        });

        function adicionarAoCarrinhoDireto(nome, preco, anuncioId = null) {
            const itemExistente = carrinho.find(p => p.nome === nome);
            if (itemExistente) {
                itemExistente.qtd++;
            } else {
                carrinho.push({
                    nome,
                    preco,
                    qtd: 1,
                    anuncioId: anuncioId || null
                });
            }
            atualizarCarrinho();
        }



        function calcularPrecoTotal() {
            let precoTotal = produtoAtual.preco;

            for (let grupoIndex in produtoAtual.grupos) {
                const grupo = produtoAtual.grupos[grupoIndex];
                const selecionados = produtoAtual.complementosSelecionados[grupoIndex];

                if (selecionados) {
                    for (let nome in selecionados) {
                        const qtd = selecionados[nome];
                        const item = grupo.itens.find(i => i.nome === nome);

                        if (item && item.preco_adicional) {
                            precoTotal += (parseFloat(item.preco_adicional) * qtd);
                        }
                    }
                }
            }

            return precoTotal;
        }

        document.addEventListener("DOMContentLoaded", function() {
            // Adiciona scroll ativo baseado na posição da seção
            const botoes = document.querySelectorAll(".categoria-scroll a");
            const secoes = [...document.querySelectorAll(".secao")];

            function atualizarCategoriaAtiva() {
                let indexAtiva = 0;
                const offsetTopo = 100;

                secoes.forEach((secao, i) => {
                    const top = secao.getBoundingClientRect().top;
                    if (top - offsetTopo < 0) indexAtiva = i;
                });

                botoes.forEach(btn => btn.classList.remove("active"));
                if (botoes[indexAtiva]) botoes[indexAtiva].classList.add("active");
            }

            window.addEventListener("scroll", atualizarCategoriaAtiva);
            atualizarCategoriaAtiva(); // chama ao iniciar
        });

        let timeoutScroll;

        window.addEventListener('scroll', () => {
            const barra = document.getElementById("barraSacola");
            const icone = document.getElementById("iconeSacola");

            if (!barra || !icone) return;

            if (barra.style.display === 'flex') {
                barra.style.display = 'none';
                icone.style.display = 'block';
            }

            clearTimeout(timeoutScroll);
            timeoutScroll = setTimeout(() => {
                if (carrinho.length > 0 && barra && icone) {
                    barra.style.display = 'flex';
                    icone.style.display = 'none';
                }
            }, 3000);
        });

        function mostrarBarraSacola() {
            document.getElementById("barraSacola").style.display = "flex";
            document.getElementById("iconeSacola").style.display = "none";
        }

        document.addEventListener("DOMContentLoaded", function() {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('cadastro') === 'ok') {
                Swal.fire({
                    icon: 'success',
                    title: 'Cadastro realizado!',
                    text: 'Seja bem-vindo(a) à Vou Food!',
                    confirmButtonColor: '#e53935',
                    timer: 3000,
                    timerProgressBar: true
                });
            }
        });

        document.addEventListener("DOMContentLoaded", function() {
            const aviso = document.getElementById('aviso-status-pedido');
            let pedidoCancelado = false;

            function verificarStatusPedido() {
                fetch('cliente/ajax_status_aviso.php')
                    .then(response => response.json())
                    .then(data => {
                        if (data && data.status) {
                            if (data.status === "entregue") {
                                aviso.style.display = 'none';
                            } else if (data.status === "cancelado") {
                                if (!pedidoCancelado) {
                                    pedidoCancelado = true;
                                    aviso.textContent = "❌ Pedido Cancelado";
                                    aviso.style.display = 'block';

                                    setTimeout(() => {
                                        aviso.style.display = 'none';
                                    }, 5000); // 10 segundos após cancelar
                                }
                            } else {
                                pedidoCancelado = false; // Reseta caso status mude novamente
                                aviso.textContent = "📦 Pedido em andamento";
                                aviso.style.display = 'block';
                            }
                        } else {
                            aviso.style.display = 'none';
                        }
                    })
                    .catch(error => {
                        console.error('Erro ao verificar status:', error);
                    });
            }

            verificarStatusPedido();
            setInterval(verificarStatusPedido, 5000); // verifica a cada 15 segundos

        });

        function irParaPedidos() {
            window.location.href = 'cliente/pedidos.php';
        }
    </script>


    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

    <!-- Ícone flutuante da sacola -->
    <div id="iconeSacola" onclick="mostrarBarraSacola()"
        style="display:none; position:fixed; bottom:80px; right:20px; z-index:9999;">
        <button class="btn btn-danger rounded-circle p-3 shadow">
            <i class="fas fa-shopping-bag fa-lg"></i>
        </button>
    </div>

    <script>
        // Função para disparar uma notificação
        function notificarMudancaStatusPedido(titulo, mensagem) {
            if (Notification.permission === "granted") {
                new Notification(titulo, {
                    body: mensagem,
                    icon: "imagens/logoloja.jpg"
                });
            }
        }

        // Monitorar se houve mudança de status nos pedidos
        function monitorarStatusPedido() {
            fetch('cliente/ajax_status_pedidos.php')
                .then(response => response.json())
                .then(data => {
                    if (data && data.status_atualizado) {
                        notificarMudancaStatusPedido('📋 Status Atualizado', 'Seu pedido foi atualizado para: ' + data.novo_status);
                    }
                })
                .catch(error => console.error('Erro ao verificar status:', error));
        }

        // Verifica a cada 15 segundos
        setInterval(monitorarStatusPedido, 5000);



        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('service-worker.js').then(function(registration) {
                    console.log('Service Worker registrado com sucesso:', registration.scope);
                }).catch(function(error) {
                    console.error('Erro ao registrar o Service Worker:', error);
                });
            });
        }



        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('button[data-anuncio-id]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    const anuncioId = this.getAttribute('data-anuncio-id');
                    fetch('admin/registrar_metrica.php', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: `anuncio_id=${anuncioId}&tipo=clique`
                    });
                });
            });
        });


        window.addEventListener("load", () => {
            const pagamentoSalvo = localStorage.getItem("forma_pagamento");
            const pagamentoSelect = document.getElementById("pagamento");
            if (pagamentoSalvo && pagamentoSelect) {
                pagamentoSelect.value = pagamentoSalvo;
                // Dispara evento para mostrar/esconder troco se necessário
                pagamentoSelect.dispatchEvent(new Event('change'));
            }
        });
    </script>




    <!-- Scripts no fim do body -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>


    <?php if (isset($_GET['acao']) && $_GET['acao'] === 'finalizar_pedido'): ?>
        <script>
            setTimeout(() => {
                finalizarPedido();
            }, 500); // ou ajuste o delay conforme necessário
        </script>
    <?php endif; ?>




</body>

</html>