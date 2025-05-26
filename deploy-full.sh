#!/bin/bash

# Script para enviar uma atualização completa para o servidor de produção

echo "=== INICIANDO DEPLOY COMPLETO NO SERVIDOR DE PRODUÇÃO ==="

# Servidor de produção
SERVER="root@167.114.223.83"

# Definir caminhos de destino no servidor
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"

# Timestamp para backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 0. Parando a aplicação existente
echo "Parando a aplicação existente..."
ssh $SERVER "screen -S feed -X quit || true"
ssh $SERVER "screen -ls | grep feed | cut -d. -f1 | xargs -r kill || true"

echo "Criando diretório de backup..."
ssh $SERVER "mkdir -p $BACKEND_PATH/backups/$TIMESTAMP"
ssh $SERVER "mkdir -p $FRONTEND_PATH/backups/$TIMESTAMP"

# 1. Backup dos arquivos existentes
echo "Fazendo backup dos arquivos existentes..."

# Backend backups
ssh $SERVER "cd $BACKEND_PATH && \
    cp -r src backups/$TIMESTAMP/ && \
    cp package.json backups/$TIMESTAMP/ && \
    cp package-lock.json backups/$TIMESTAMP/ && \
    cp index.js backups/$TIMESTAMP/ && \
    cp start-production.sh backups/$TIMESTAMP/ && \
    cp .env.production backups/$TIMESTAMP/"

# Frontend backups
ssh $SERVER "cd $FRONTEND_PATH && \
    cp -r src/components backups/$TIMESTAMP/"

# 2. Enviando arquivos do backend
echo "Enviando arquivos do backend..."

# Enviando diretórios completos
echo "Enviando diretório src..."
scp -r backend/src/* $SERVER:$BACKEND_PATH/src/

# Garante que o arquivo HomeDepotCartApi.js foi enviado corretamente (arquivo novo)
echo "Garantindo que o HomeDepotCartApi.js foi enviado..."
scp backend/src/services/homeDepotCartApi.js $SERVER:$BACKEND_PATH/src/services/

# Garante que o arquivo homeDepotApi.js foi enviado corretamente (arquivo modificado)
echo "Garantindo que o homeDepotApi.js foi enviado..."
scp backend/src/services/homeDepotApi.js $SERVER:$BACKEND_PATH/src/services/

# Garante que o home-depot-provider.js foi enviado corretamente (arquivo modificado)
echo "Garantindo que o home-depot-provider.js foi enviado..."
scp backend/src/providers/home-depot-provider.js $SERVER:$BACKEND_PATH/src/providers/

# Enviando arquivos individuais
echo "Enviando arquivos de configuração..."
scp backend/package.json backend/package-lock.json backend/index.js backend/start-production.sh $SERVER:$BACKEND_PATH/

# Enviando arquivo .env.production
echo "Enviando arquivo .env.production..."
scp backend/.env.production $SERVER:$BACKEND_PATH/

# 3. Enviando arquivos do frontend
echo "Enviando arquivos do frontend..."

# Enviando todos os componentes
scp -r frontend/src/components/* $SERVER:$FRONTEND_PATH/src/components/

# Garante que o NextSyncTimer.tsx foi enviado corretamente (arquivo modificado)
echo "Garantindo que o NextSyncTimer.tsx foi enviado..."
scp frontend/src/components/NextSyncTimer.tsx $SERVER:$FRONTEND_PATH/src/components/

# 4. Configurando permissões
echo "Configurando permissões..."
ssh $SERVER "chmod +x $BACKEND_PATH/start-production.sh"

# 5. Instalando dependências (caso necessário)
echo "Instalando dependências do backend..."
ssh $SERVER "cd $BACKEND_PATH && npm install"

# 6. Iniciando a aplicação
echo "Iniciando a aplicação com screen..."
ssh $SERVER "cd $BACKEND_PATH && screen -dmS feed ./start-production.sh"

echo "=== DEPLOY COMPLETO FINALIZADO ==="
echo "Para verificar os logs: ssh $SERVER 'screen -r feed'"
echo "Para sair da screen após verificar logs: Use Ctrl+A seguido de D" 