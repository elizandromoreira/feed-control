#!/bin/bash

# Script otimizado para migrar Feed Control para PM2

SERVER="root@167.114.223.83"

echo "=== MIGRANDO FEED CONTROL PARA PM2 (VERSÃO LIMPA) ==="

# Enviar ecosystem config
echo "Enviando configuração PM2..."
scp ecosystem.config.js $SERVER:/opt/feed-control/

# Executar migração no servidor
ssh $SERVER << 'EOF'
    cd /opt/feed-control
    
    echo "=== LIMPANDO CONFIGURAÇÕES ANTIGAS ==="
    
    # Remover processo PM2 antigo do frontend se existir
    echo "Removendo processo PM2 antigo..."
    pm2 delete feed-control-frontend 2>/dev/null || true
    
    # Parar screens atuais
    echo "Parando screens..."
    screen -S feedcontrol-backend -X quit 2>/dev/null || true
    screen -S feedcontrol-frontend -X quit 2>/dev/null || true
    
    # Aguardar
    sleep 2
    
    echo "=== PREPARANDO AMBIENTE ==="
    
    # Instalar serve globalmente para o frontend
    echo "Verificando/instalando serve..."
    npm list -g serve || npm install -g serve
    
    # Criar diretórios de logs
    echo "Criando diretórios de logs..."
    mkdir -p /opt/feed-control/logs
    mkdir -p /opt/feed-control-frontend/logs
    
    echo "=== INICIANDO SERVIÇOS COM PM2 ==="
    
    # Iniciar com PM2 usando o ecosystem file
    pm2 start ecosystem.config.js
    
    # Salvar configuração PM2
    echo "Salvando configuração PM2..."
    pm2 save
    
    # Garantir que PM2 inicie no boot (se ainda não estiver configurado)
    echo "Verificando startup do PM2..."
    pm2 startup systemd -u root --hp /root | grep -v "sudo" | bash 2>/dev/null || true
    
    echo ""
    echo "=== STATUS FINAL ==="
    pm2 list
    
    echo ""
    echo "=== MIGRAÇÃO CONCLUÍDA COM SUCESSO ==="
    echo ""
    echo "Comandos úteis:"
    echo "  Status geral:        pm2 list"
    echo "  Logs backend:        pm2 logs feedcontrol-backend"
    echo "  Logs frontend:       pm2 logs feedcontrol-frontend"
    echo "  Logs em tempo real:  pm2 logs --lines 50"
    echo "  Monitoramento:       pm2 monit"
    echo "  Reiniciar backend:   pm2 restart feedcontrol-backend"
    echo "  Reiniciar frontend:  pm2 restart feedcontrol-frontend"
    echo "  Reiniciar tudo:      pm2 restart all"
    echo ""
    echo "URLs de acesso:"
    echo "  Backend:  http://167.114.223.83:7005"
    echo "  Frontend: http://167.114.223.83:8080"
EOF
