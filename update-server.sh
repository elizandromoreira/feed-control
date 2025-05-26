#!/bin/bash

# Script para enviar as atualizações para o servidor de produção

echo "=== ATUALIZANDO ARQUIVOS NO SERVIDOR DE PRODUÇÃO ==="

# Servidor de produção
SERVER="root@167.114.223.83"

# Definir caminhos de destino no servidor
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"

# 1. Enviando arquivos do backend
echo "Enviando index.js atualizado..."
scp backend/index.js $SERVER:$BACKEND_PATH/

echo "Enviando start-production.sh atualizado..."
scp backend/start-production.sh $SERVER:$BACKEND_PATH/

echo "Enviando package.json atualizado..."
scp backend/package.json $SERVER:$BACKEND_PATH/

# 2. Enviando arquivos do frontend
echo "Enviando NextSyncTimer.tsx atualizado..."
scp frontend/src/components/NextSyncTimer.tsx $SERVER:$FRONTEND_PATH/src/components/

# 3. Configurando permissões no servidor
echo "Configurando permissões dos arquivos..."
ssh $SERVER "chmod +x $BACKEND_PATH/start-production.sh"

# 4. Reiniciando o servidor
echo "Reiniciando a aplicação..."
ssh $SERVER "cd $BACKEND_PATH && pm2 restart feed-control"

echo "=== ATUALIZAÇÃO CONCLUÍDA ===" 