#!/bin/bash

# Script para enviar uma atualização completa para o servidor de produção
# Versão melhorada com verificação de erros

echo "=== INICIANDO DEPLOY COMPLETO NO SERVIDOR DE PRODUÇÃO ==="

# Servidor de produção
SERVER="root@167.114.223.83"

# Definir caminhos de destino no servidor
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"

# Timestamp para backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Função para verificar erros
check_error() {
  if [ $? -ne 0 ]; then
    echo "ERRO: $1"
    exit 1
  else
    echo "✓ $1 concluído com sucesso."
  fi
}

# 0. Verificando conexão com o servidor
echo "Verificando conexão com o servidor..."
ssh -o ConnectTimeout=5 $SERVER "echo 'Conexão estabelecida com sucesso!'" || { echo "ERRO: Não foi possível conectar ao servidor."; exit 1; }

# 1. Parando a aplicação existente
echo "Parando a aplicação existente..."
ssh $SERVER "pm2 stop feed-control || true"
ssh $SERVER "screen -S feed -X quit 2>/dev/null || true"

# 2. Criando diretório de backup
echo "Criando diretório de backup..."
ssh $SERVER "mkdir -p $BACKEND_PATH/backups/$TIMESTAMP"
check_error "Criação do diretório de backup do backend"
ssh $SERVER "mkdir -p $FRONTEND_PATH/backups/$TIMESTAMP"
check_error "Criação do diretório de backup do frontend"

# 3. Backup dos arquivos existentes
echo "Fazendo backup dos arquivos existentes..."

# Backend backups
ssh $SERVER "cd $BACKEND_PATH && \
    cp -r src backups/$TIMESTAMP/ 2>/dev/null || mkdir -p backups/$TIMESTAMP/src && \
    cp package.json backups/$TIMESTAMP/ 2>/dev/null || touch backups/$TIMESTAMP/package.json && \
    cp package-lock.json backups/$TIMESTAMP/ 2>/dev/null || touch backups/$TIMESTAMP/package-lock.json && \
    cp index.js backups/$TIMESTAMP/ 2>/dev/null || touch backups/$TIMESTAMP/index.js && \
    cp start-production.sh backups/$TIMESTAMP/ 2>/dev/null || touch backups/$TIMESTAMP/start-production.sh && \
    cp .env.production backups/$TIMESTAMP/ 2>/dev/null || touch backups/$TIMESTAMP/.env.production"
check_error "Backup dos arquivos do backend"

# Frontend backups
ssh $SERVER "cd $FRONTEND_PATH && \
    mkdir -p backups/$TIMESTAMP/components && \
    cp -r src/components backups/$TIMESTAMP/ 2>/dev/null || true"
check_error "Backup dos arquivos do frontend"

# 4. Garantindo que os diretórios existem no servidor
echo "Garantindo que os diretórios existem no servidor..."
ssh $SERVER "mkdir -p $BACKEND_PATH/src/services $BACKEND_PATH/src/providers $FRONTEND_PATH/src/components/providers"
check_error "Criação dos diretórios necessários"

# 5. Enviando arquivos do backend
echo "Enviando arquivos do backend..."

# Enviando diretórios principais
echo "Enviando diretório src..."
scp -r backend/src/* $SERVER:$BACKEND_PATH/src/
check_error "Envio do diretório src"

# Garantindo que arquivos críticos foram enviados
echo "Garantindo que arquivos críticos foram enviados..."
scp backend/src/services/homeDepotCartApi.js $SERVER:$BACKEND_PATH/src/services/
check_error "Envio do homeDepotCartApi.js"

scp backend/src/services/homeDepotApi.js $SERVER:$BACKEND_PATH/src/services/
check_error "Envio do homeDepotApi.js"

scp backend/src/providers/home-depot-provider.js $SERVER:$BACKEND_PATH/src/providers/
check_error "Envio do home-depot-provider.js"

scp backend/src/sync/sync-service.js $SERVER:$BACKEND_PATH/src/sync/
check_error "Envio do sync-service.js"

# Enviando arquivos de configuração
echo "Enviando arquivos de configuração..."
scp backend/package.json backend/index.js backend/start-production.sh $SERVER:$BACKEND_PATH/
check_error "Envio dos arquivos de configuração"

# Enviando arquivo .env.production se existir
if [ -f backend/.env.production ]; then
  echo "Enviando arquivo .env.production..."
  scp backend/.env.production $SERVER:$BACKEND_PATH/
  check_error "Envio do arquivo .env.production"
fi

# 6. Enviando arquivos do frontend
echo "Enviando arquivos do frontend..."

# Enviando componentes
echo "Enviando componentes do frontend..."
scp -r frontend/src/components/* $SERVER:$FRONTEND_PATH/src/components/
check_error "Envio dos componentes do frontend"

# Garantindo que arquivos críticos do frontend foram enviados
echo "Garantindo que arquivos críticos do frontend foram enviados..."
scp frontend/src/components/NextSyncTimer.tsx $SERVER:$FRONTEND_PATH/src/components/
check_error "Envio do NextSyncTimer.tsx"

scp frontend/src/components/StoreDashboard.tsx $SERVER:$FRONTEND_PATH/src/components/
check_error "Envio do StoreDashboard.tsx"

scp frontend/src/components/StoresList.tsx $SERVER:$FRONTEND_PATH/src/components/
check_error "Envio do StoresList.tsx"

scp frontend/src/components/providers/ProviderConfigFactory.tsx $SERVER:$FRONTEND_PATH/src/components/providers/
check_error "Envio do ProviderConfigFactory.tsx"

# 7. Configurando permissões
echo "Configurando permissões..."
ssh $SERVER "chmod +x $BACKEND_PATH/start-production.sh"
check_error "Configuração de permissões"

# 8. Instalando dependências (caso necessário)
echo "Instalando dependências do backend..."
ssh $SERVER "cd $BACKEND_PATH && npm install"
check_error "Instalação de dependências"

# 9. Reiniciando a aplicação
echo "Iniciando a aplicação..."
ssh $SERVER "cd $BACKEND_PATH && pm2 restart feed-control || pm2 start index.js --name feed-control"
check_error "Inicialização da aplicação"

echo ""
echo "=== DEPLOY COMPLETO FINALIZADO COM SUCESSO ==="
echo "Para verificar os logs: ssh $SERVER 'pm2 logs feed-control'"
echo ""