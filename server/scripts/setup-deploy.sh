#!/bin/bash
# Setup auto-deploy: installs cron, webhook server, and firewall rule
# Run this once on your server: sudo bash server/scripts/setup-deploy.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_DIR="${1:-/opt/money-machine}"

echo "================================================================"
echo "  DEPLOY SYSTEM SETUP"
echo "================================================================"
echo ""

# 1. Setup cron job for auto-pull
echo -e "${YELLOW}[1/4] Setting up auto-pull cron (every 2 min)...${NC}"

CRON_CMD="*/2 * * * * cd ${REPO_DIR} && bash server/scripts/auto-deploy.sh >> /var/log/auto-deploy.log 2>&1"
(crontab -l 2>/dev/null | grep -v "auto-deploy.sh"; echo "$CRON_CMD") | crontab -
echo -e "${GREEN}Cron job installed${NC}"

# 2. Create systemd service for webhook
echo -e "${YELLOW}[2/4] Creating webhook systemd service...${NC}"

cat > /etc/systemd/system/webhook-deploy.service << SVCEOF
[Unit]
Description=GitHub Webhook Deploy Receiver
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=/usr/bin/npx tsx server/scripts/webhook-server.ts
Environment="WEBHOOK_PORT=9000"
Environment="WEBHOOK_SECRET=${WEBHOOK_SECRET:-changeme}"
Environment="DEPLOY_REPO_DIR=${REPO_DIR}"
Environment="DEPLOY_BRANCH=main"
EnvironmentFile=-${REPO_DIR}/.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable webhook-deploy
systemctl restart webhook-deploy
echo -e "${GREEN}Webhook service installed and started${NC}"

# 3. Open firewall for webhook
echo -e "${YELLOW}[3/4] Opening firewall port 9000...${NC}"
ufw allow 9000/tcp comment 'Webhook Deploy' 2>/dev/null || true
echo -e "${GREEN}Port 9000 open${NC}"

# 4. Create log file
echo -e "${YELLOW}[4/4] Creating log file...${NC}"
touch /var/log/auto-deploy.log
chmod 666 /var/log/auto-deploy.log
echo -e "${GREEN}Log file ready${NC}"

echo ""
echo "================================================================"
echo "  DEPLOY SYSTEM READY"
echo "================================================================"
echo ""
echo "Auto-Pull:  Runs every 2 minutes via cron"
echo "Webhook:    http://$(hostname -I | awk '{print $1}'):9000/webhook"
echo "Health:     http://$(hostname -I | awk '{print $1}'):9000/health"
echo "Logs:       tail -f /var/log/auto-deploy.log"
echo ""
echo "GitHub Webhook Setup:"
echo "  1. Go to your repo Settings > Webhooks > Add webhook"
echo "  2. Payload URL: http://65.21.203.174:9000/webhook"
echo "  3. Content type: application/json"
echo "  4. Secret: (set WEBHOOK_SECRET in .env)"
echo "  5. Events: Just the push event"
echo ""
echo "Telegram Bot: Use /deploy for manual deploys"
echo ""
