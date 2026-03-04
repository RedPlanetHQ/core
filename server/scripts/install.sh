#!/bin/bash
set -e

echo "================================================================"
echo "  MONEY-MACHINE FULL INSTALLATION"
echo "================================================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Bitte als root ausfuehren: sudo $0${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/8] System Update...${NC}"
apt-get update -qq
apt-get upgrade -y -qq
echo -e "${GREEN}System Update Complete${NC}"

echo -e "${YELLOW}[2/8] Install Dependencies...${NC}"
apt-get install -y -qq \
    curl git wget npm nodejs python3 python3-pip python3-venv \
    bc htop tmux nfs-kernel-server postgresql postgresql-contrib \
    ufw fail2ban
echo -e "${GREEN}Dependencies Installed${NC}"

echo -e "${YELLOW}[3/8] Install Ollama...${NC}"
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.ai/install.sh | sh
    echo -e "${GREEN}Ollama Installed${NC}"
else
    echo -e "${GREEN}Ollama Already Installed${NC}"
fi

echo -e "${YELLOW}[4/8] Pull GLM4 Model...${NC}"
ollama pull glm4:9b-chat &
echo -e "${GREEN}GLM4 downloading in background...${NC}"

echo -e "${YELLOW}[5/8] Install Python Packages...${NC}"
pip3 install --break-system-packages -q \
    streamlit pandas plotly requests python-dotenv
echo -e "${GREEN}Python Packages Installed${NC}"

echo -e "${YELLOW}[6/8] Create Workspace...${NC}"
mkdir -p /opt/money-machine/{openclaw/{agents,sessions,memory,cron,logs},server/{scripts,systemd,config,backup},dashboard}
echo -e "${GREEN}Workspace Created${NC}"

echo -e "${YELLOW}[7/8] Configure Ollama Service...${NC}"
cat > /etc/systemd/system/ollama.service << 'SVCEOF'
[Unit]
Description=Ollama Service
After=network.target

[Service]
ExecStart=/usr/local/bin/ollama serve
Environment="OLLAMA_NUM_PARALLEL=15"
Environment="OLLAMA_MAX_LOADED_MODELS=5"
Environment="OLLAMA_FLASH_ATTENTION=1"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama
echo -e "${GREEN}Ollama Service Configured${NC}"

echo -e "${YELLOW}[8/8] Configure Firewall...${NC}"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 11434/tcp comment 'Ollama'
ufw allow 8503/tcp comment 'Dashboard'
ufw allow from 100.64.0.0/10 comment 'Tailscale'
echo "y" | ufw --force enable
echo -e "${GREEN}Firewall Configured${NC}"

echo ""
echo "================================================================"
echo "  INSTALLATION COMPLETE!"
echo "================================================================"
echo ""
echo "Next Steps:"
echo "  1. ollama pull glm4:9b-chat  (falls noch nicht fertig)"
echo "  2. bash server/scripts/start-all.sh"
echo "  3. streamlit run dashboard/dashboard.py --server.port 8503"
echo ""
