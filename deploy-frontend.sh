#!/bin/bash

# Script para enviar as alterações do frontend para o servidor

echo "=== ENVIANDO ALTERAÇÕES DO FRONTEND PARA O SERVIDOR ==="

# Servidor de produção
SERVER="root@167.114.223.83"

# Definir caminho de destino no servidor
FRONTEND_PATH="/opt/feed-control-frontend"

# 1. Backup dos componentes
echo "Fazendo backup dos componentes do frontend..."
ssh $SERVER "cd $FRONTEND_PATH && mkdir -p backups/$(date +%Y%m%d_%H%M%S)/src/components && \
    cp -r src/components backups/$(date +%Y%m%d_%H%M%S)/src/"

# 2. Enviando arquivos do frontend
echo "Enviando componentes modificados..."

# Garantir que o StoreDashboard.tsx foi enviado
echo "Enviando StoreDashboard.tsx atualizado..."
scp frontend/src/components/StoreDashboard.tsx $SERVER:$FRONTEND_PATH/src/components/

echo "=== DEPLOY DO FRONTEND FINALIZADO ==="
echo "Reinicie o servidor frontend se necessário" 