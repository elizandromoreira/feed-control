#!/bin/bash

# Script para enviar as atualizações para o servidor de produção

echo "=== ATUALIZANDO ARQUIVOS NO SERVIDOR DE PRODUÇÃO ==="

# Servidor de produção
PRODUCTION_SERVER="root@167.114.223.83"

# Definir caminhos de destino no servidor
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"

echo "Iniciando envio de atualização para o servidor..."

# Fazer backup dos arquivos importantes
echo "Fazendo backup dos arquivos importantes..."
ssh $PRODUCTION_SERVER "mkdir -p $BACKEND_PATH/backups/$(date +%Y%m%d_%H%M%S)"
ssh $PRODUCTION_SERVER "cp $BACKEND_PATH/index.js $BACKEND_PATH/backups/$(date +%Y%m%d_%H%M%S)/"
ssh $PRODUCTION_SERVER "cp $BACKEND_PATH/start-production.sh $BACKEND_PATH/backups/$(date +%Y%m%d_%H%M%S)/"
ssh $PRODUCTION_SERVER "cp $BACKEND_PATH/package.json $BACKEND_PATH/backups/$(date +%Y%m%d_%H%M%S)/"

# Enviar arquivos do backend
echo "Enviando arquivos do backend..."
scp backend/index.js $PRODUCTION_SERVER:$BACKEND_PATH/
scp backend/start-production.sh $PRODUCTION_SERVER:$BACKEND_PATH/
scp backend/package.json $PRODUCTION_SERVER:$BACKEND_PATH/

# Enviar arquivos de serviços
echo "Enviando arquivos de serviços..."
ssh $PRODUCTION_SERVER "mkdir -p $BACKEND_PATH/src/services"
ssh $PRODUCTION_SERVER "mkdir -p $BACKEND_PATH/src/providers"
scp backend/src/services/homeDepotCartApi.js $PRODUCTION_SERVER:$BACKEND_PATH/src/services/
scp backend/src/services/homeDepotApi.js $PRODUCTION_SERVER:$BACKEND_PATH/src/services/
scp backend/src/providers/home-depot-provider.js $PRODUCTION_SERVER:$BACKEND_PATH/src/providers/

# Fazer backup dos componentes do frontend
echo "Fazendo backup dos componentes do frontend..."
ssh $PRODUCTION_SERVER "mkdir -p $FRONTEND_PATH/backups/$(date +%Y%m%d_%H%M%S)/components"
ssh $PRODUCTION_SERVER "cp -r $FRONTEND_PATH/src/components/NextSyncTimer.tsx $FRONTEND_PATH/backups/$(date +%Y%m%d_%H%M%S)/components/"

# Enviar arquivos do frontend
echo "Enviando arquivos do frontend..."
scp -r frontend/src/components/NextSyncTimer.tsx $PRODUCTION_SERVER:$FRONTEND_PATH/src/components/

# Configurar permissões
echo "Configurando permissões..."
ssh $PRODUCTION_SERVER "chmod +x $BACKEND_PATH/start-production.sh"

# Reiniciar a aplicação com PM2
echo "Reiniciando a aplicação..."
ssh $PRODUCTION_SERVER "cd $BACKEND_PATH && pm2 restart feed-control"

echo "=== ATUALIZAÇÃO CONCLUÍDA ==="
echo "Para verificar os logs: ssh $PRODUCTION_SERVER \"pm2 logs feed-control\"" 