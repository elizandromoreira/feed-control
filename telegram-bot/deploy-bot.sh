#!/bin/bash

# Deploy Telegram Bot to server

SERVER="root@167.114.223.83"
BOT_PATH="/opt/feedcontrol-telegram-bot"

echo "=== DEPLOYING TELEGRAM BOT ==="

# Create directory on server
echo "Creating bot directory..."
ssh $SERVER "mkdir -p $BOT_PATH"

# Copy files
echo "Copying bot files..."
scp -r package.json bot.js .env $SERVER:$BOT_PATH/

# Install dependencies
echo "Installing dependencies..."
ssh $SERVER "cd $BOT_PATH && npm install"

# Create systemd service
echo "Creating systemd service..."
ssh $SERVER "cat > /etc/systemd/system/feedcontrol-bot.service << EOL
[Unit]
Description=Feed Control Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$BOT_PATH
ExecStart=/usr/bin/node $BOT_PATH/bot.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL"

# Reload systemd and start bot
echo "Starting bot service..."
ssh $SERVER "systemctl daemon-reload && \
             systemctl enable feedcontrol-bot && \
             systemctl restart feedcontrol-bot"

# Check status
echo "Checking bot status..."
ssh $SERVER "systemctl status feedcontrol-bot --no-pager"

echo "=== BOT DEPLOYED ==="
echo "Commands:"
echo "  Status: systemctl status feedcontrol-bot"
echo "  Logs:   journalctl -u feedcontrol-bot -f"
echo "  Restart: systemctl restart feedcontrol-bot"
