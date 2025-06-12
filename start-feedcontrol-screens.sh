#!/bin/bash

# Script para iniciar o Feed Control com screens separadas para frontend e backend

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== INICIANDO FEED CONTROL COM SCREENS ===${NC}"

# Diretórios
BACKEND_PATH="/opt/feed-control"
FRONTEND_PATH="/opt/feed-control-frontend"
BOT_PATH="/opt/feed-control/telegram-bot"

# Matar screens antigas se existirem
echo -e "${YELLOW}Verificando screens existentes...${NC}"
screen -ls | grep feedcontrol-backend && {
    echo -e "${YELLOW}Matando screen feedcontrol-backend antiga...${NC}"
    screen -S feedcontrol-backend -X quit
}
screen -ls | grep feedcontrol-frontend && {
    echo -e "${YELLOW}Matando screen feedcontrol-frontend antiga...${NC}"
    screen -S feedcontrol-frontend -X quit
}
screen -ls | grep feedcontrol-bot && {
    echo -e "${YELLOW}Matando screen feedcontrol-bot antiga...${NC}"
    screen -S feedcontrol-bot -X quit
}

# Aguardar um momento para garantir que as screens foram finalizadas
sleep 2

# Iniciar backend
echo -e "${GREEN}Iniciando backend na screen feedcontrol-backend...${NC}"
screen -dmS feedcontrol-backend bash -c "
    cd $BACKEND_PATH/backend
    echo '=== FEED CONTROL BACKEND ==='
    echo 'Iniciando servidor na porta 7005...'
    
    export NODE_ENV=production
    export PORT=7005
    node index.js
"

# Aguardar backend iniciar
echo -e "${GREEN}Aguardando backend iniciar...${NC}"
sleep 5

# Iniciar frontend
echo -e "${GREEN}Iniciando frontend na screen feedcontrol-frontend...${NC}"
screen -dmS feedcontrol-frontend bash -c "
    cd $FRONTEND_PATH
    echo '=== FEED CONTROL FRONTEND ==='
    echo 'Iniciando servidor frontend...'
    
    # Verificar se é um projeto React com build
    if [ -d 'build' ]; then
        echo 'Servindo build estático na porta 8080...'
        # Usar Python para servir arquivos estáticos
        cd build
        python3 -m http.server 8080
    else
        # Se for desenvolvimento, usar npm start
        echo 'Iniciando em modo desenvolvimento...'
        npm start
    fi
"

# Iniciar Telegram Bot
echo -e "${GREEN}Iniciando Telegram Bot na screen feedcontrol-bot...${NC}"
screen -dmS feedcontrol-bot bash -c "
    cd $BOT_PATH
    echo '=== FEED CONTROL TELEGRAM BOT ==='
    echo 'Iniciando bot do Telegram...'
    
    export NODE_ENV=production
    node bot.js
"

echo -e "${GREEN}=== FEED CONTROL INICIADO COM SUCESSO ===${NC}"
echo ""
echo -e "${BLUE}Comandos úteis:${NC}"
echo -e "  Ver logs do backend:   ${YELLOW}screen -r feedcontrol-backend${NC}"
echo -e "  Ver logs do frontend:  ${YELLOW}screen -r feedcontrol-frontend${NC}"
echo -e "  Ver logs do bot:       ${YELLOW}screen -r feedcontrol-bot${NC}"
echo -e "  Listar screens:        ${YELLOW}screen -ls${NC}"
echo -e "  Sair de uma screen:    ${YELLOW}Ctrl+A seguido de D${NC}"
echo ""
echo -e "${GREEN}Backend rodando em:${NC} http://167.114.223.83:7005"
echo -e "${GREEN}Frontend rodando em:${NC} http://167.114.223.83:8080"
echo -e "${GREEN}Telegram Bot:${NC} Rodando em background"
