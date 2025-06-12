#!/bin/bash

# Deploy and restart script with screens
SERVER="root@167.114.223.83"
REMOTE_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"

echo "=== DEPLOY E RESTART DO FEED CONTROL ==="

# Fazer backup remoto
echo "Fazendo backup dos arquivos existentes..."
ssh $SERVER "cd $REMOTE_PATH && tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz backend telegram-bot 2>/dev/null || true"
ssh $SERVER "cd $FRONTEND_PATH && tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz build 2>/dev/null || true"

# Enviar arquivos do backend
echo "Enviando arquivos do backend..."
rsync -avz --exclude 'node_modules' --exclude '.env.local' --exclude '.env.development' \
    backend/ $SERVER:$REMOTE_PATH/backend/

# Enviar bot do Telegram
echo "Enviando arquivos do bot do Telegram..."
rsync -avz --exclude 'node_modules' --exclude '.env.local' --exclude '.env.development' \
    telegram-bot/ $SERVER:$REMOTE_PATH/telegram-bot/

# Enviar script de inicialização
echo "Enviando script de inicialização com screens..."
scp start-feedcontrol-screens.sh $SERVER:$REMOTE_PATH/

# Build do frontend localmente
echo "Preparando frontend..."
cd frontend
echo "Fazendo build do frontend..."
npm run build

# Enviar build do frontend
echo "Enviando build do frontend..."
rsync -avz build/ $SERVER:$FRONTEND_PATH/build/
cd ..

# Instalar dependências no servidor
echo "Instalando dependências no servidor..."
ssh $SERVER "cd $REMOTE_PATH/backend && npm install --production"
ssh $SERVER "cd $REMOTE_PATH/telegram-bot && npm install --production"

# Parar serviços usando systemd
echo "Parando serviços antigos..."
ssh $SERVER "systemctl stop feedcontrol || true"

# Iniciar serviços com systemd
echo "Iniciando serviços com screens..."
ssh $SERVER "systemctl start feedcontrol"

echo "=== DEPLOY COMPLETO ==="
echo ""
echo "Para verificar os logs:"
echo "  Backend:  ssh $SERVER 'screen -r feedcontrol-backend'"
echo "  Frontend: ssh $SERVER 'screen -r feedcontrol-frontend'"
echo "  Bot:      ssh $SERVER 'screen -r feedcontrol-bot'"
echo ""
echo "URLs:"
echo "  Backend:  http://167.114.223.83:7005"
echo "  Frontend: http://167.114.223.83:8080"
