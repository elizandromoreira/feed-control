#!/bin/bash

# Script para iniciar o backend em ambiente de produção

# Definir cores para saída
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== INICIANDO APLICAÇÃO EM MODO DE PRODUÇÃO ===${NC}"
echo -e "${GREEN}Diretório atual: $(pwd)${NC}"

# Verificar se o arquivo .env.production existe
if [ -f .env.production ]; then
    echo -e "${GREEN}Arquivo .env.production encontrado${NC}"

    # Criar backup do arquivo .env.production
    cp .env.production .env.production.bak
    echo -e "${GREEN}Backup do arquivo .env.production criado em .env.production.bak${NC}"

    # Executar o script de verificação de configurações
    echo -e "${GREEN}Verificando se todas as configurações necessárias estão definidas...${NC}"
    ./ensureProviderConfigs.sh

    # Verificar permissões do script ensureProviderConfigs.sh
    if [ ! -x ./ensureProviderConfigs.sh ]; then
        echo -e "${YELLOW}Ajustando permissões do script ensureProviderConfigs.sh${NC}"
        chmod +x ./ensureProviderConfigs.sh
        ./ensureProviderConfigs.sh
    fi
else
    echo -e "${RED}Arquivo .env.production não encontrado${NC}"
    echo -e "${YELLOW}Criando arquivo .env.production com configurações básicas...${NC}"
    
    # Criar arquivo .env.production com configurações mínimas
    cat > .env.production << EOL
NODE_ENV=production
PORT=7005
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=password
DB_NAME=feed_control
LEAD_TIME_OMD=2
LOGGING_LEVEL=info
EOL
    
    # Executar o script de verificação de configurações
    echo -e "${GREEN}Verificando e adicionando configurações necessárias...${NC}"
    chmod +x ./ensureProviderConfigs.sh
    ./ensureProviderConfigs.sh
fi

# Verificar e instalar dependências
echo -e "${GREEN}Verificando e instalando dependências...${NC}"
npm install --production

# Iniciar o servidor em modo de produção
echo -e "${GREEN}Iniciando o servidor em 0.0.0.0:7005...${NC}"

# Definir variáveis de ambiente essenciais
export NODE_ENV=production
export UV_THREADPOOL_SIZE=64  # Aumentar o número de threads para melhor desempenho

# Iniciar o servidor
node index.js

# Este ponto só será atingido se o servidor terminar
echo -e "${RED}O servidor foi encerrado. Verifique os logs para mais informações.${NC}"
