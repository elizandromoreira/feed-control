#!/bin/bash

# Configurações
LOCAL_FRONTEND_DIR="frontend"
LOCAL_BUILD_DIR="$LOCAL_FRONTEND_DIR/build"
REMOTE_USER="root"
REMOTE_HOST="167.114.223.83"
REMOTE_TARGET_DIR="/var/www/html/feed-control"

echo "=== INICIANDO DEPLOY DO FRONTEND PARA O SERVIDOR ==="

# 1. Navegar para o diretório do frontend
echo "--> Navegando para o diretório $LOCAL_FRONTEND_DIR..."
cd "$LOCAL_FRONTEND_DIR" || { echo "Erro ao entrar no diretório $LOCAL_FRONTEND_DIR"; exit 1; }

# 2. Construir a aplicação React
echo "--> Construindo a aplicação (npm run build)..."
npm run build || { echo "Erro durante o build do frontend"; exit 1; }

# Voltar para o diretório raiz (opcional, boa prática)
cd ..

# 3. Limpar diretório de destino no servidor (CUIDADO!)
echo "--> Limpando diretório de destino $REMOTE_TARGET_DIR no servidor $REMOTE_HOST..."
ssh "$REMOTE_USER@$REMOTE_HOST" "rm -rf $REMOTE_TARGET_DIR/*" || { echo "Erro ao limpar diretório remoto"; exit 1; }

# 4. Copiar os arquivos de build para o servidor
echo "--> Copiando arquivos de $LOCAL_BUILD_DIR para $REMOTE_TARGET_DIR no servidor $REMOTE_HOST..."
scp -r "$LOCAL_BUILD_DIR/"* "$REMOTE_USER@$REMOTE_HOST:$REMOTE_TARGET_DIR/" || { echo "Erro ao copiar arquivos para o servidor"; exit 1; }
# A barra em "$LOCAL_BUILD_DIR/"* é importante para copiar o *conteúdo* da pasta

# 5. Reiniciar Nginx no servidor
echo "--> Reiniciando Nginx no servidor $REMOTE_HOST..."
ssh "$REMOTE_USER@$REMOTE_HOST" "sudo systemctl restart nginx" || { echo "Erro ao reiniciar Nginx"; exit 1; }

echo "=== DEPLOY DO FRONTEND CONCLUÍDO COM SUCESSO ==="

exit 0
