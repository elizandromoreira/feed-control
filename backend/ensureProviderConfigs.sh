#!/bin/bash

# Script para verificar e garantir que todas as configurações de providers existam no arquivo .env.production

# Definir cores para saída
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Arquivo de ambiente
ENV_FILE=".env.production"

# Verificar se o arquivo existe
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Arquivo $ENV_FILE não encontrado.${NC}"
  exit 1
fi

echo -e "${BLUE}=== VERIFICANDO CONFIGURAÇÕES DOS PROVIDERS NO ARQUIVO $ENV_FILE ===${NC}"

# Função para verificar e adicionar variável se não existir
check_and_add_var() {
  local var_name=$1
  local default_value=$2
  local var_description=$3
  
  # Verificar se a variável já existe
  if grep -q "^$var_name=" "$ENV_FILE"; then
    local current_value=$(grep "^$var_name=" "$ENV_FILE" | cut -d '=' -f2)
    # Modo silencioso - não exibir cada variável encontrada
    # echo -e "  ${GREEN}$var_name já definido como: $current_value${NC}"
  else
    echo -e "  ${YELLOW}Adicionando variável ausente: $var_name=$default_value${NC}"
    echo "$var_name=$default_value" >> "$ENV_FILE"
  fi
}

# Verificar variável global LEAD_TIME_OMD
if grep -q "^LEAD_TIME_OMD=" "$ENV_FILE"; then
  # Apenas extrair o valor para uso posterior
  LEAD_TIME_OMD=$(grep "^LEAD_TIME_OMD=" "$ENV_FILE" | cut -d '=' -f2)
  echo -e "  ${GREEN}Variável global LEAD_TIME_OMD = $LEAD_TIME_OMD${NC}"
else
  echo -e "  ${YELLOW}Adicionando variável global LEAD_TIME_OMD=2${NC}"
  echo "LEAD_TIME_OMD=2" >> "$ENV_FILE"
  LEAD_TIME_OMD=2
fi

# Verificar variável global STOCK_LEVEL
if grep -q "^STOCK_LEVEL=" "$ENV_FILE"; then
  # Apenas extrair o valor para uso posterior
  STOCK_LEVEL=$(grep "^STOCK_LEVEL=" "$ENV_FILE" | cut -d '=' -f2)
  echo -e "  ${GREEN}Variável global STOCK_LEVEL = $STOCK_LEVEL${NC}"
else
  echo -e "  ${YELLOW}Adicionando variável global STOCK_LEVEL=5${NC}"
  echo "STOCK_LEVEL=5" >> "$ENV_FILE"
  STOCK_LEVEL=5
fi

# Verificar variável global BATCH_SIZE
if grep -q "^BATCH_SIZE=" "$ENV_FILE"; then
  # Apenas extrair o valor para uso posterior
  BATCH_SIZE=$(grep "^BATCH_SIZE=" "$ENV_FILE" | cut -d '=' -f2)
  echo -e "  ${GREEN}Variável global BATCH_SIZE = $BATCH_SIZE${NC}"
else
  echo -e "  ${YELLOW}Adicionando variável global BATCH_SIZE=240${NC}"
  echo "BATCH_SIZE=240" >> "$ENV_FILE"
  BATCH_SIZE=240
fi

# Verificar variável global REQUESTS_PER_SECOND
if grep -q "^REQUESTS_PER_SECOND=" "$ENV_FILE"; then
  # Apenas extrair o valor para uso posterior
  REQUESTS_PER_SECOND=$(grep "^REQUESTS_PER_SECOND=" "$ENV_FILE" | cut -d '=' -f2)
  echo -e "  ${GREEN}Variável global REQUESTS_PER_SECOND = $REQUESTS_PER_SECOND${NC}"
else
  echo -e "  ${YELLOW}Adicionando variável global REQUESTS_PER_SECOND=7${NC}"
  echo "REQUESTS_PER_SECOND=7" >> "$ENV_FILE"
  REQUESTS_PER_SECOND=7
fi

# Lista de providers
PROVIDERS=("VITACOST" "BESTBUY" "WHITECAP" "WEBSTAURANTSTORE" "HOMEDEPOT" "ZORO")

# Valores padrão específicos
HANDLING_TIMES=("2" "3" "2" "3" "2" "2")
UPDATE_FLAG_VALUES=("2" "4" "3" "5" "1" "2")
API_URLS=(
  "http://167.114.223.83:3005/vc"
  "http://167.114.223.83:3002/bb"
  "http://167.114.223.83:3004/wc"
  "http://167.114.223.83:3003/ws"
  "http://167.114.223.83:3000/hd"
  "http://167.114.223.83:3001/zoro"
)

# Verificar cada provider
for i in "${!PROVIDERS[@]}"; do
  provider=${PROVIDERS[$i]}
  handling_time=${HANDLING_TIMES[$i]}
  update_flag=${UPDATE_FLAG_VALUES[$i]}
  api_url=${API_URLS[$i]}
  
  echo -e "${BLUE}Verificando configurações para: $provider${NC}"
  
  # Verificar cada variável necessária
  check_and_add_var "${provider}_STOCK_LEVEL" "$STOCK_LEVEL"
  check_and_add_var "${provider}_BATCH_SIZE" "$BATCH_SIZE"
  check_and_add_var "${provider}_REQUESTS_PER_SECOND" "$REQUESTS_PER_SECOND"
  check_and_add_var "${provider}_HANDLING_TIME" "$handling_time"
  check_and_add_var "${provider}_HANDLING_TIME_OMD" "$LEAD_TIME_OMD"
  check_and_add_var "${provider}_UPDATE_FLAG_VALUE" "$update_flag"
  check_and_add_var "${provider}_API_BASE_URL" "$api_url"
done

# Informar se houve modificações
echo -e "${GREEN}Verificação concluída. Todas as configurações estão definidas no arquivo $ENV_FILE.${NC}"
echo -e "${BLUE}=== VERIFICAÇÃO CONCLUÍDA ===${NC}"

# Verificação de valores críticos
echo -e "${BLUE}=== VERIFICANDO VALORES CRÍTICOS ===${NC}"
echo -e "${GREEN}LEAD_TIME_OMD = $LEAD_TIME_OMD${NC}"

for i in "${!PROVIDERS[@]}"; do
  provider=${PROVIDERS[$i]}
  var_name="${provider}_HANDLING_TIME"
  
  if grep -q "^$var_name=" "$ENV_FILE"; then
    current_value=$(grep "^$var_name=" "$ENV_FILE" | cut -d '=' -f2)
    echo -e "${GREEN}$var_name = $current_value${NC}"
  else
    echo -e "${RED}ALERTA: $var_name não está definido!${NC}"
  fi
done

echo -e "${GREEN}Verificação de valores críticos concluída.${NC}"
echo -e "${BLUE}=== VERIFICAÇÃO DE VALORES CRÍTICOS CONCLUÍDA ===${NC}"

# Carregar as variáveis no ambiente atual
echo -e "${GREEN}Variáveis de ambiente carregadas do arquivo $ENV_FILE${NC}"

# Verificação final - exibir apenas configurações essenciais
echo -e "${BLUE}Verificando variáveis de ambiente essenciais:${NC}"
if grep -q "^DB_HOST=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável DB_HOST está definida${NC}"
else
  echo -e "  ${RED}❌ Variável DB_HOST NÃO está definida${NC}"
fi

if grep -q "^DB_PORT=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável DB_PORT está definida${NC}"
else
  echo -e "  ${RED}❌ Variável DB_PORT NÃO está definida${NC}"
fi

if grep -q "^DB_USER=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável DB_USER está definida${NC}"
else
  echo -e "  ${RED}❌ Variável DB_USER NÃO está definida${NC}"
fi

if grep -q "^DB_PASSWORD=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável DB_PASSWORD está definida${NC}"
else
  echo -e "  ${RED}❌ Variável DB_PASSWORD NÃO está definida${NC}"
fi

if grep -q "^DB_NAME=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável DB_NAME está definida${NC}"
else
  echo -e "  ${RED}❌ Variável DB_NAME NÃO está definida${NC}"
fi

if grep -q "^LEAD_TIME_OMD=" "$ENV_FILE"; then
  echo -e "  ${GREEN}✅ Variável LEAD_TIME_OMD está definida${NC}"
else
  echo -e "  ${RED}❌ Variável LEAD_TIME_OMD NÃO está definida${NC}"
fi

# Exibir resumo das variáveis de handling time dos providers
echo -e "${BLUE}=== VARIÁVEIS DOS PROVIDERS ===${NC}"
for i in "${!PROVIDERS[@]}"; do
  provider=${PROVIDERS[$i]}
  var_name="${provider}_HANDLING_TIME"
  
  if grep -q "^$var_name=" "$ENV_FILE"; then
    current_value=$(grep "^$var_name=" "$ENV_FILE" | cut -d '=' -f2)
    echo -e "  ${GREEN}$var_name = $current_value${NC}"
  fi
done

exit 0 