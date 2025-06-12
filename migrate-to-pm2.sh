#!/bin/bash

# Script para migrar de screen para PM2

SERVER="root@167.114.223.83"

echo "=== MIGRANDO FEED CONTROL PARA PM2 ==="

# Enviar ecosystem config
echo "Enviando configuração PM2..."
scp ecosystem.config.js $SERVER:/opt/feed-control/

# Executar migração no servidor
ssh $SERVER << 'EOF'
    cd /opt/feed-control
    
    # Instalar PM2 globalmente se não estiver instalado
    echo "Verificando PM2..."
    if ! command -v pm2 &> /dev/null; then
        echo "Instalando PM2..."
        npm install -g pm2
    fi
    
    # Instalar serve para o frontend
    echo "Instalando serve para o frontend..."
    npm install -g serve
    
    # Criar diretórios de logs
    echo "Criando diretórios de logs..."
    mkdir -p /opt/feed-control/logs
    mkdir -p /opt/feed-control-frontend/logs
    
    # Parar screens antigas
    echo "Parando screens antigas..."
    screen -S feedcontrol-backend -X quit 2>/dev/null || true
    screen -S feedcontrol-frontend -X quit 2>/dev/null || true
    
    # Aguardar
    sleep 2
    
    # Iniciar com PM2
    echo "Iniciando aplicações com PM2..."
    pm2 start ecosystem.config.js
    
    # Salvar configuração PM2
    echo "Salvando configuração PM2..."
    pm2 save
    
    # Configurar auto-start
    echo "Configurando auto-start..."
    pm2 startup systemd -u root --hp /root
    systemctl enable pm2-root
    
    # Mostrar status
    echo ""
    echo "=== STATUS DAS APLICAÇÕES ==="
    pm2 list
    
    echo ""
    echo "=== MIGRAÇÃO CONCLUÍDA ==="
    echo "As aplicações agora são gerenciadas pelo PM2 e reiniciarão automaticamente!"
    echo ""
    echo "Comandos úteis PM2:"
    echo "  Ver status:      pm2 list"
    echo "  Ver logs backend:  pm2 logs feedcontrol-backend"
    echo "  Ver logs frontend: pm2 logs feedcontrol-frontend"
    echo "  Reiniciar tudo:    pm2 restart all"
    echo "  Parar tudo:        pm2 stop all"
    echo "  Monitorar:         pm2 monit"
EOF
