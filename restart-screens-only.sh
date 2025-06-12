#!/bin/bash

# Script para apenas reiniciar as screens no servidor (sem deploy)

SERVER="root@167.114.223.83"

echo "=== REINICIANDO SCREENS DO FEED CONTROL ==="

# Executar comando remoto para reiniciar screens
ssh $SERVER << 'EOF'
    # Parar screens antigas
    echo "Parando screens antigas..."
    screen -S feedcontrol-backend -X quit 2>/dev/null || true
    screen -S feedcontrol-frontend -X quit 2>/dev/null || true
    screen -S feed -X quit 2>/dev/null || true
    
    # Aguardar
    sleep 2
    
    # Executar script de inicialização
    echo "Iniciando screens..."
    cd /opt/feed-control
    
    # Verificar se o script existe
    if [ -f ./start-feedcontrol-screens.sh ]; then
        ./start-feedcontrol-screens.sh
    else
        echo "ERRO: Script start-feedcontrol-screens.sh não encontrado!"
        echo "Execute primeiro o deploy-and-restart-screens.sh"
        exit 1
    fi
EOF

echo ""
echo "=== SCREENS REINICIADAS ==="
echo "Para verificar status: ssh $SERVER 'screen -ls'"
