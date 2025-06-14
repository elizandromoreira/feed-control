#!/bin/bash

# Script para fazer um deploy completo com limpeza total dos diretórios
# Criado em: 13/06/2025

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== INICIANDO DEPLOY COMPLETO COM LIMPEZA TOTAL ===${NC}"

# Configurações
SERVER="root@167.114.223.83"
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"
BOT_PATH="/opt/feed-control/telegram-bot"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/opt/backups/feed-control"

# 1. Criar diretório de backup se não existir
echo -e "${YELLOW}Criando diretório de backup...${NC}"
ssh $SERVER "mkdir -p $BACKUP_DIR"

# 2. Fazer backup completo antes de remover qualquer coisa
echo -e "${YELLOW}Fazendo backup completo dos arquivos existentes...${NC}"
ssh $SERVER "mkdir -p $BACKUP_DIR/$TIMESTAMP"

# Backup do backend (incluindo bot)
echo -e "${YELLOW}Backup do backend e bot...${NC}"
ssh $SERVER "if [ -d '$BACKEND_PATH' ]; then tar -czf $BACKUP_DIR/$TIMESTAMP/backend-full.tar.gz -C $BACKEND_PATH . 2>/dev/null || true; fi"

# Backup do frontend
echo -e "${YELLOW}Backup do frontend...${NC}"
ssh $SERVER "if [ -d '$FRONTEND_PATH' ]; then tar -czf $BACKUP_DIR/$TIMESTAMP/frontend-full.tar.gz -C $FRONTEND_PATH . 2>/dev/null || true; fi"

# Backup específico de arquivos importantes
echo -e "${YELLOW}Backup de arquivos de configuração importantes...${NC}"
ssh $SERVER "if [ -f '$BACKEND_PATH/.env.production' ]; then cp $BACKEND_PATH/.env.production $BACKUP_DIR/$TIMESTAMP/ 2>/dev/null || true; fi"
ssh $SERVER "if [ -d '$BACKEND_PATH/logs' ]; then tar -czf $BACKUP_DIR/$TIMESTAMP/logs.tar.gz -C $BACKEND_PATH logs 2>/dev/null || true; fi"

# 3. Parar serviços do Feed Control
echo -e "${RED}Parando serviço feedcontrol...${NC}"
ssh $SERVER "systemctl stop feedcontrol || true"

# Matar apenas a screen do bot do Feed Control
echo -e "${RED}Parando screen do bot do Feed Control...${NC}"
ssh $SERVER "screen -ls | grep feedcontrol-bot | cut -d. -f1 | xargs -r kill || true"
ssh $SERVER "sleep 2" # Aguardar para garantir que tudo foi encerrado

# 4. Remover diretórios existentes (preservando logs e .env)
echo -e "${RED}Removendo diretórios existentes...${NC}"

# Salvar temporariamente arquivos importantes
ssh $SERVER "if [ -f '$BACKEND_PATH/.env.production' ]; then cp $BACKEND_PATH/.env.production /tmp/.env.production.backup 2>/dev/null || true; fi"
ssh $SERVER "if [ -d '$BACKEND_PATH/logs' ]; then mkdir -p /tmp/logs_backup && cp -r $BACKEND_PATH/logs/* /tmp/logs_backup/ 2>/dev/null || true; fi"

# Remover diretórios
ssh $SERVER "rm -rf $BACKEND_PATH/* || true"
ssh $SERVER "rm -rf $FRONTEND_PATH/* || true"

# 5. Recriar estrutura de diretórios
echo -e "${GREEN}Recriando estrutura de diretórios...${NC}"
ssh $SERVER "mkdir -p $BACKEND_PATH/src"
ssh $SERVER "mkdir -p $BACKEND_PATH/logs"
ssh $SERVER "mkdir -p $FRONTEND_PATH/build"
ssh $SERVER "mkdir -p $BOT_PATH"

# Restaurar arquivos importantes
ssh $SERVER "if [ -f '/tmp/.env.production.backup' ]; then mv /tmp/.env.production.backup $BACKEND_PATH/.env.production; fi"
ssh $SERVER "if [ -d '/tmp/logs_backup' ]; then cp -r /tmp/logs_backup/* $BACKEND_PATH/logs/ 2>/dev/null || true; rm -rf /tmp/logs_backup; fi"

# 6. Enviar todos os arquivos novos
echo -e "${GREEN}Enviando arquivos do backend...${NC}"
rsync -avz --delete \
  --exclude 'node_modules/' \
  --exclude '*.log' \
  --exclude '*.csv' \
  --exclude 'feeds/' \
  --exclude 'logs/' \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude 'package-lock.json' \
  --exclude 'tests/providers/test-*.js' \
  --exclude 'README.md' \
  --exclude '.DS_Store' \
  --exclude 'venv/' \
  --exclude '.venv/' \
  --exclude 'python_env/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '*.pyo' \
  --exclude '*.pyd' \
  --exclude '.env.local' \
  --exclude '.env.development' \
  backend/ $SERVER:$BACKEND_PATH/

echo -e "${GREEN}Enviando arquivos do bot do Telegram...${NC}"
rsync -avz --delete \
  --exclude 'node_modules/' \
  --exclude '*.log' \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude 'package-lock.json' \
  --exclude 'README.md' \
  --exclude '.DS_Store' \
  telegram-bot/ $SERVER:$BOT_PATH/

# Build do frontend localmente
# Isso inclui a nova configuração da API que detecta automaticamente o ambiente
echo -e "${YELLOW}Preparando frontend...${NC}"
cd frontend
echo -e "${YELLOW}Fazendo build do frontend...${NC}"
npm run build

# Enviar build do frontend
echo -e "${GREEN}Enviando build do frontend...${NC}"
rsync -avz --delete \
  --exclude '.DS_Store' \
  --exclude '*.map' \
  build/ $SERVER:$FRONTEND_PATH/build/
cd ..

# 7. Enviar script de inicialização
echo -e "${GREEN}Enviando script de inicialização com screens...${NC}"
scp start-feedcontrol-screens.sh $SERVER:$BACKEND_PATH/

# Atualizar o script para usar serve em vez de Python
echo -e "${YELLOW}Atualizando script para usar serve...${NC}"
ssh $SERVER "sed -i 's|python3 -m http.server 8080|serve -s -l 8080|' $BACKEND_PATH/start-feedcontrol-screens.sh"

# 8. Configurar permissões
echo -e "${YELLOW}Configurando permissões...${NC}"
ssh $SERVER "chmod +x $BACKEND_PATH/start-feedcontrol-screens.sh"
ssh $SERVER "chmod -R 755 $BACKEND_PATH/src"
ssh $SERVER "chmod -R 755 $BOT_PATH"

# 9. Instalar dependências
echo -e "${YELLOW}Instalando dependências no servidor...${NC}"
ssh $SERVER "cd $BACKEND_PATH && npm install --production"
ssh $SERVER "cd $BOT_PATH && npm install --production"

# Instalar serve globalmente para servir o frontend
echo -e "${YELLOW}Instalando serve para o frontend...${NC}"
ssh $SERVER "npm install -g serve"

# 10. Iniciar serviços
echo -e "${GREEN}Iniciando serviços...${NC}"
ssh $SERVER "systemctl start feedcontrol || true"

# Iniciar bot do Telegram em uma screen separada
echo -e "${GREEN}Iniciando bot do Telegram...${NC}"
ssh $SERVER "cd $BOT_PATH && screen -dmS feedcontrol-bot node bot.js"

# 11. Verificar status
echo -e "${BLUE}Verificando status dos serviços...${NC}"
ssh $SERVER "sleep 5 && systemctl status feedcontrol --no-pager | head -n 3"
ssh $SERVER "screen -ls | grep feedcontrol-bot || echo 'Bot screen não encontrada!'"

echo -e "${GREEN}=== DEPLOY COMPLETO FINALIZADO ===${NC}"
echo ""
echo -e "${BLUE}Informações importantes:${NC}"
echo -e "  Backend:  ${YELLOW}http://167.114.223.83:7005${NC}"
echo -e "  Frontend: ${YELLOW}http://167.114.223.83:8080${NC}"
echo -e ""
echo -e "${BLUE}Para verificar os logs:${NC}"
echo -e "  Backend:  ${YELLOW}ssh $SERVER 'journalctl -u feedcontrol -f'${NC}"
echo -e "  Bot:      ${YELLOW}ssh $SERVER 'screen -r feedcontrol-bot'${NC}"
echo -e "  Sair da screen: ${YELLOW}Ctrl+A seguido de D${NC}"
echo -e ""
echo -e "${BLUE}Backup realizado em:${NC} ${YELLOW}$BACKUP_DIR/$TIMESTAMP${NC}"
