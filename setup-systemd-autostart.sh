#!/bin/bash

# Script para configurar auto-start do Feed Control com systemd

SERVER="root@167.114.223.83"

echo "=== CONFIGURANDO AUTO-START DO FEED CONTROL ==="

# Enviar arquivo de serviço
echo "Enviando arquivo de serviço systemd..."
scp feedcontrol.service $SERVER:/etc/systemd/system/

# Configurar no servidor
ssh $SERVER << 'EOF'
    echo "Recarregando systemd..."
    systemctl daemon-reload
    
    echo "Habilitando serviço para iniciar no boot..."
    systemctl enable feedcontrol.service
    
    echo "Status do serviço:"
    systemctl status feedcontrol.service --no-pager
    
    echo ""
    echo "=== CONFIGURAÇÃO CONCLUÍDA ==="
    echo "O Feed Control agora iniciará automaticamente quando o servidor reiniciar!"
    echo ""
    echo "Comandos úteis:"
    echo "  Iniciar serviço:  systemctl start feedcontrol"
    echo "  Parar serviço:    systemctl stop feedcontrol"
    echo "  Reiniciar:        systemctl restart feedcontrol"
    echo "  Ver status:       systemctl status feedcontrol"
    echo "  Ver logs:         journalctl -u feedcontrol -f"
EOF
