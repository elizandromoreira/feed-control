# Feed Control Telegram Bot

Control your Feed Control application from anywhere using Telegram!

## Features

- 📊 **Status Monitoring**: Check service status, screens, and systemd
- 🔄 **Service Control**: Restart all services, backend, or frontend
- 📜 **Log Viewing**: View recent logs from backend, frontend, or system
- 🌐 **API Health Check**: Verify if APIs are responding
- 📈 **System Info**: Check server resources (CPU, memory, disk)
- 🚀 **Deployment**: Deploy updates directly from Telegram
- 🔒 **Secure**: Only authorized users can control the bot

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the instructions
3. Save the bot token

### 2. Get Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Save this ID

### 3. Configure the Bot

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   SSH_HOST=167.114.223.83
   SSH_USER=root
   SSH_PASSWORD=your_password
   AUTHORIZED_USERS=your_telegram_id
   BACKEND_URL=http://167.114.223.83:7005
   FRONTEND_URL=http://167.114.223.83:8080
   ```

### 4. Deploy to Server

```bash
chmod +x deploy-bot.sh
./deploy-bot.sh
```

## Bot Commands

### Main Commands
- `/start` - Start the bot and show main menu
- `/help` - Show all available commands
- `/status` - Check service status

### Service Control
- `/restart` - Show restart menu
- `/restart_all` - Restart all services
- `/restart_backend` - Restart backend only
- `/restart_frontend` - Restart frontend only
- `/stop` - Stop all services
- `/start` - Start all services

### Logs
- `/logs` - Show logs menu
- `/logs_backend` - View backend logs
- `/logs_frontend` - View frontend logs

### System
- `/apis` - Check API health
- `/system` - Show system resources
- `/screens` - List active screens

## Interactive Menu

The bot provides an interactive inline keyboard menu for easy navigation:

```
📊 Status     🔄 Restart
📜 Logs       🚀 Deploy
🌐 Check APIs 📈 System Info
```

## Security

- Only users listed in `AUTHORIZED_USERS` can use the bot
- SSH credentials are stored in environment variables
- Bot runs as a systemd service with automatic restart

## Managing the Bot

### On the server:

```bash
# Check status
systemctl status feedcontrol-bot

# View logs
journalctl -u feedcontrol-bot -f

# Restart bot
systemctl restart feedcontrol-bot

# Stop bot
systemctl stop feedcontrol-bot
```

### Update bot code:

1. Make changes locally
2. Run `./deploy-bot.sh` again

## Troubleshooting

1. **Bot not responding**: Check if the service is running
2. **Unauthorized error**: Make sure your Telegram ID is in AUTHORIZED_USERS
3. **SSH errors**: Verify SSH credentials in .env file
4. **API check failing**: Ensure the URLs in .env are correct

## Adding More Users

To authorize more users, add their Telegram IDs to `AUTHORIZED_USERS` in `.env`:
```
AUTHORIZED_USERS=123456789,987654321,555555555
```

Then restart the bot:
```bash
ssh root@167.114.223.83 'systemctl restart feedcontrol-bot'
```
