<?php
session_start();
if (!isset($_SESSION['logado']) || $_SESSION['logado'] !== true) {
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'Sessão não iniciada. Faça login no sistema primeiro.']);
    exit;
}
include 'conexao.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['key'], $_POST['expires_at'])) {
    $key = $conn->real_escape_string($_POST['key']);
    $expires_at = $conn->real_escape_string($_POST['expires_at']);

    $conn->query("INSERT INTO configuracoes (chave, valor) VALUES ('licenca_key', '$key') ON DUPLICATE KEY UPDATE valor = '$key'");
    $conn->query("INSERT INTO configuracoes (chave, valor) VALUES ('licenca_expira_em', '$expires_at') ON DUPLICATE KEY UPDATE valor = '$expires_at'");

    echo json_encode(['success' => true]);
} else {
    echo json_encode(['success' => false, 'message' => 'Dados inválidos.']);
}
