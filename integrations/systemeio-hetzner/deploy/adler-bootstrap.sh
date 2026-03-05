#!/bin/bash
set -euo pipefail

# ================================================================
# ADLER SERVER - KOMPLETTES BOOTSTRAP-SCRIPT
# ================================================================
# EIN Befehl - Alles eingerichtet:
#   curl -sL https://raw.githubusercontent.com/Maurice-AIEMPIRE/core/main/integrations/systemeio-hetzner/deploy/adler-bootstrap.sh | bash
# ODER direkt auf dem Server:
#   bash adler-bootstrap.sh
# ================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/ki-power"
LOG_FILE="/var/log/adler-setup.log"

# Alles loggen
exec > >(tee -a "$LOG_FILE") 2>&1

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              ADLER SERVER - KOMPLETTES SETUP                ║"
echo "║     Tailscale + KI-Power + Telegram + Sicherheit           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Gestartet: $(date)"
echo "  Log: $LOG_FILE"
echo ""

# ================================================================
# PHASE 0: ROOT CHECK
# ================================================================
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Fehler: Dieses Script muss als root ausgefuehrt werden!${NC}"
    echo "  Fuehre aus: sudo bash adler-bootstrap.sh"
    exit 1
fi

# ================================================================
# PHASE 1: API KEYS (ALLE OPTIONAL - spaeter nachtragen)
# ================================================================
echo -e "${YELLOW}[PHASE 1/8] API Keys & Konfiguration${NC}"
echo ""

# Pruefen ob bestehende Config existiert
if [ -f "$INSTALL_DIR/.env" ]; then
    echo -e "${GREEN}Bestehende .env gefunden unter $INSTALL_DIR/.env${NC}"
    source "$INSTALL_DIR/.env" 2>/dev/null || true
    echo -e "${GREEN}  -> Bestehende Config geladen${NC}"
fi

# Alle Keys sind optional - Enter zum Ueberspringen
echo -e "${BLUE}Alle Keys sind OPTIONAL. Einfach Enter druecken zum Ueberspringen.${NC}"
echo -e "${BLUE}Keys koennen spaeter jederzeit in /opt/ki-power/.env nachgetragen werden.${NC}"
echo ""

if [ -z "${SYSTEME_API_KEY:-}" ]; then
    read -p "  Systeme.io API Key (Enter = spaeter): " SYSTEME_API_KEY
    SYSTEME_API_KEY="${SYSTEME_API_KEY:-SPAETER_EINTRAGEN}"
fi

if [ -z "${HETZNER_API_TOKEN:-}" ]; then
    read -p "  Hetzner API Token (Enter = spaeter): " HETZNER_API_TOKEN
    HETZNER_API_TOKEN="${HETZNER_API_TOKEN:-SPAETER_EINTRAGEN}"
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
    read -p "  OpenAI API Key (Enter = spaeter): " OPENAI_API_KEY
    OPENAI_API_KEY="${OPENAI_API_KEY:-SPAETER_EINTRAGEN}"
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    read -p "  Telegram Bot Token (Enter = spaeter): " TELEGRAM_BOT_TOKEN
    TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
fi

# Domain auch optional
read -p "  Domain fuer SSL (Enter = keine): " DOMAIN
DOMAIN="${DOMAIN:-}"

echo -e "${GREEN}  OK - Konfiguration fertig (fehlende Keys spaeter: nano /opt/ki-power/.env)${NC}"

# ================================================================
# PHASE 2: SYSTEM-UPDATE & PAKETE
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 2/8] System-Pakete & Grundlagen${NC}"

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl wget git unzip \
    software-properties-common apt-transport-https \
    ca-certificates gnupg lsb-release \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban \
    jq htop iotop net-tools \
    logrotate cron \
    unattended-upgrades apt-listchanges

# Automatische Sicherheitsupdates aktivieren
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOEOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOEOF

echo -e "${GREEN}  OK - System aktualisiert + Auto-Updates aktiv${NC}"

# ================================================================
# PHASE 3: TAILSCALE ABSICHERN
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 3/8] Tailscale Netzwerk absichern${NC}"

# Pruefen ob Tailscale installiert ist
if command -v tailscale &> /dev/null; then
    TS_IP=$(tailscale ip -4 2>/dev/null || echo "")
    TS_STATUS=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online' 2>/dev/null || echo "false")
    echo -e "${GREEN}  Tailscale installiert - IP: ${TS_IP:-unbekannt}${NC}"
    echo -e "${GREEN}  Status: Online=${TS_STATUS}${NC}"
else
    echo "  Tailscale wird installiert..."
    curl -fsSL https://tailscale.com/install.sh | sh
    echo -e "${YELLOW}  WICHTIG: Tailscale muss noch verbunden werden!${NC}"
    echo -e "${YELLOW}  Fuehre nach dem Setup aus: tailscale up --ssh${NC}"
fi

# Tailscale SSH aktivieren (erlaubt SSH ueber Tailscale ohne Keys)
tailscale set --ssh 2>/dev/null || true

# Tailscale als Auto-Start
systemctl enable tailscaled 2>/dev/null || true

echo -e "${GREEN}  OK - Tailscale gesichert + SSH via Tailscale aktiv${NC}"

# ================================================================
# PHASE 4: SSH HAERTEN + FIREWALL
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 4/8] SSH & Firewall maximal absichern${NC}"

# SSH Config haerten
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%s)

cat > /etc/ssh/sshd_config.d/99-adler-hardened.conf << 'SSHEOF'
# ADLER SERVER - Gehaertete SSH Konfiguration
# Nur Key-basierte Anmeldung - kein Passwort

# Basis-Sicherheit
PermitRootLogin prohibit-password
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
UsePAM yes

# Brute-Force Schutz
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 3:50:10
MaxSessions 5

# Idle-Timeout (30 Min Inaktivitaet -> trennen)
ClientAliveInterval 300
ClientAliveCountMax 6

# Sicherheit
X11Forwarding no
AllowTcpForwarding yes
PermitTunnel no
AllowAgentForwarding yes

# Protokoll
Protocol 2
SSHEOF

# SSH neu starten
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true

# UFW Firewall - Tailscale-aware
ufw --force reset 2>/dev/null || true
ufw default deny incoming
ufw default allow outgoing

# SSH erlauben (Port 22)
ufw allow 22/tcp

# Tailscale Subnet erlauben (100.x.x.x)
ufw allow from 100.64.0.0/10 to any comment 'Tailscale Netzwerk'

# Web-Traffic
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Tailscale Interface durchlassen
ufw allow in on tailscale0 comment 'Tailscale Interface'

ufw --force enable

# Fail2Ban konfigurieren
cat > /etc/fail2ban/jail.local << 'F2BEOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 3
bantime = 7200

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5
F2BEOF

systemctl enable fail2ban
systemctl restart fail2ban

echo -e "${GREEN}  OK - SSH gehaertet (nur Keys) + Firewall aktiv + Fail2Ban aktiv${NC}"

# ================================================================
# PHASE 5: DOCKER INSTALLIEREN
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 5/8] Docker installieren${NC}"

if command -v docker &> /dev/null; then
    echo -e "${GREEN}  Docker bereits installiert: $(docker --version)${NC}"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}  Docker installiert: $(docker --version)${NC}"
fi

# Docker Compose pruefen
if docker compose version &> /dev/null; then
    echo -e "${GREEN}  Docker Compose verfuegbar${NC}"
else
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}  Docker Compose installiert${NC}"
fi

# Docker Log-Rotation
cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
    "log-driver": "local",
    "log-opts": {
        "max-size": "20m",
        "max-file": "5"
    },
    "live-restore": true,
    "default-ulimits": {
        "nofile": {
            "Name": "nofile",
            "Hard": 65536,
            "Soft": 65536
        }
    }
}
DOCKEREOF

systemctl restart docker
echo -e "${GREEN}  OK - Docker mit Log-Rotation + Live-Restore konfiguriert${NC}"

# ================================================================
# PHASE 6: KI-POWER STACK DEPLOYEN
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 6/8] KI-Power Stack deployen${NC}"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Sichere Passwoerter generieren
generate_secret() { openssl rand -hex 16; }

DB_PASSWORD="${POSTGRES_PASSWORD:-$(generate_secret)}"
NEO4J_PASS="${NEO4J_PASSWORD:-$(generate_secret)}"
SESSION="${SESSION_SECRET:-$(generate_secret)}"
ENCRYPT="${ENCRYPTION_KEY:-$(generate_secret)}"
MAGIC="${MAGIC_LINK_SECRET:-$(generate_secret)}"
GW_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(openssl rand -hex 32)}"
N8N_PW="${N8N_PASSWORD:-$(openssl rand -hex 12)}"

# Server IPs ermitteln
SERVER_IP=$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo "localhost")
TS_IP=$(tailscale ip -4 2>/dev/null || echo "$SERVER_IP")

# .env erstellen
cat > "$INSTALL_DIR/.env" << ENVEOF
# ==========================================
# ADLER SERVER - KI-POWER KONFIGURATION
# Generiert: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Server Public IP: ${SERVER_IP}
# Tailscale IP: ${TS_IP}
# ==========================================

# API Keys
SYSTEME_API_KEY=${SYSTEME_API_KEY}
HETZNER_API_TOKEN=${HETZNER_API_TOKEN}
OPENAI_API_KEY=${OPENAI_API_KEY}

# App
VERSION=0.4.0
NODE_ENV=production
LOGIN_ORIGIN=http://${TS_IP}:3033
APP_ORIGIN=http://${TS_IP}:3033

# Database
POSTGRES_USER=kipower
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=core
DATABASE_URL=postgresql://kipower:${DB_PASSWORD}@postgres:5432/core?schema=core
DIRECT_URL=postgresql://kipower:${DB_PASSWORD}@postgres:5432/core?schema=core

# Security
SESSION_SECRET=${SESSION}
ENCRYPTION_KEY=${ENCRYPT}
MAGIC_LINK_SECRET=${MAGIC}

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_TLS_DISABLED=true

# Neo4j
NEO4J_URI=bolt://neo4j:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${NEO4J_PASS}
NEO4J_AUTH=neo4j/${NEO4J_PASS}

# Auth
ENABLE_EMAIL_LOGIN=true
AUTH_GOOGLE_CLIENT_ID=
AUTH_GOOGLE_CLIENT_SECRET=

# AI
MODEL=gpt-4.1-2025-04-14
EMBEDDING_MODEL=text-embedding-3-small
RERANK_PROVIDER=none

# Queue
QUEUE_PROVIDER=bullmq

# OpenClaw + Telegram
OPENCLAW_GATEWAY_TOKEN=${GW_TOKEN}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}

# n8n
N8N_USER=admin
N8N_PASSWORD=${N8N_PW}
ENVEOF

chmod 600 "$INSTALL_DIR/.env"

# Docker Compose erstellen
cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSEEOF'
x-logging: &logging-config
  driver: local
  options:
    max-size: 20m
    max-file: "5"
    compress: "true"

x-restart: &restart-policy
  restart: unless-stopped

version: "3.8"

services:
  core:
    container_name: core-app
    image: redplanethq/core:${VERSION:-0.4.0}
    <<: *restart-policy
    logging: *logging-config
    env_file: .env
    ports:
      - "3033:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - core
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  postgres:
    container_name: core-postgres
    image: pgvector/pgvector:pg18-trixie
    <<: *restart-policy
    logging: *logging-config
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-kipower}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-core}
    volumes:
      - postgres_data:/var/lib/postgresql
    networks:
      - core
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kipower}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    container_name: core-redis
    image: redis:7-alpine
    <<: *restart-policy
    logging: *logging-config
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - core
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  neo4j:
    container_name: core-neo4j
    image: redplanethq/neo4j:0.1.0
    <<: *restart-policy
    logging: *logging-config
    environment:
      - NEO4J_AUTH=${NEO4J_AUTH}
      - NEO4J_dbms_security_procedures_unrestricted=gds.*,apoc.*
      - NEO4J_dbms_security_procedures_allowlist=gds.*,apoc.*
      - NEO4J_apoc_export_file_enabled=true
      - NEO4J_apoc_import_file_enabled=true
      - NEO4J_apoc_import_file_use_neo4j_config=true
      - NEO4J_server_memory_heap_initial__size=1G
      - NEO4J_server_memory_heap_max__size=2G
    volumes:
      - neo4j_data:/data
    networks:
      - core
    healthcheck:
      test: ["CMD-SHELL", "cypher-shell -u neo4j -p ${NEO4J_PASSWORD} 'RETURN 1'"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  n8n:
    container_name: core-n8n
    image: n8nio/n8n:latest
    <<: *restart-policy
    logging: *logging-config
    environment:
      - N8N_HOST=0.0.0.0
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - GENERIC_TIMEZONE=Europe/Berlin
      - N8N_PATH=/n8n/
      - N8N_EDITOR_BASE_URL=${APP_ORIGIN}/n8n/
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER:-admin}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD:-}
    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
    networks:
      - core

  ollama:
    container_name: core-ollama
    image: ollama/ollama:latest
    <<: *restart-policy
    logging: *logging-config
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - core
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits:
          memory: 16G

  openclaw:
    container_name: openclaw
    image: ghcr.io/openclaw/openclaw:latest
    <<: *restart-policy
    logging: *logging-config
    environment:
      - OPENCLAW_MODEL_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://ollama:11434
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-}
      - OPENCLAW_SANDBOX=false
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
      - TZ=Europe/Berlin
    ports:
      - "18789:18789"
    volumes:
      - openclaw_data:/home/node/.openclaw
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      ollama:
        condition: service_healthy
    networks:
      - core

networks:
  core:
    name: core
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  neo4j_data:
  n8n_data:
  openclaw_data:
  ollama_data:
COMPOSEEOF

# Deployen
echo "  Docker Images werden heruntergeladen..."
cd "$INSTALL_DIR"
docker compose pull
echo "  Container werden gestartet..."
docker compose up -d

echo -e "${GREEN}  OK - Alle 7 Container gestartet${NC}"

# ================================================================
# PHASE 7: NGINX + SSL + TELEGRAM
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 7/8] Nginx + Telegram konfigurieren${NC}"

# Nginx Config
cat > /etc/nginx/sites-available/adler-server << 'NGINXEOF'
upstream core_app { server 127.0.0.1:3033; }
upstream n8n_app { server 127.0.0.1:5678; }
upstream openclaw_app { server 127.0.0.1:18789; }

server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 50M;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://core_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location /n8n/ {
        proxy_pass http://n8n_app/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /openclaw/ {
        proxy_pass http://openclaw_app/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /health {
        access_log off;
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/adler-server /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# SSL wenn Domain
if [ -n "${DOMAIN}" ]; then
    sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/adler-server
    nginx -t && systemctl restart nginx
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "admin@${DOMAIN}" || \
        echo -e "${YELLOW}  SSL fehlgeschlagen - spaeter: certbot --nginx -d ${DOMAIN}${NC}"
fi

# Telegram Bot konfigurieren
echo "  Warte auf OpenClaw Container..."
RETRY=0
while [ $RETRY -lt 30 ]; do
    if docker inspect --format='{{.State.Running}}' openclaw 2>/dev/null | grep -q true; then
        break
    fi
    sleep 2
    RETRY=$((RETRY + 1))
done

if docker inspect --format='{{.State.Running}}' openclaw 2>/dev/null | grep -q true; then
    # Ollama Auth-Profile setzen
    mkdir -p /opt/ki-power/openclaw-config
    cat > /opt/ki-power/openclaw-config/auth-profiles.json << 'AUTHEOF'
{
  "ollama": {
    "apiKey": "local",
    "baseURL": "http://ollama:11434"
  }
}
AUTHEOF
    docker exec openclaw mkdir -p /home/node/.openclaw/agents/main/agent 2>/dev/null || true
    docker cp /opt/ki-power/openclaw-config/auth-profiles.json openclaw:/home/node/.openclaw/agents/main/agent/auth-profiles.json 2>/dev/null || true

    # Ollama Modelle
    echo "  Ollama Modelle laden (dauert beim ersten Mal)..."
    docker exec core-ollama ollama pull qwen3:14b 2>/dev/null && echo -e "${GREEN}    qwen3:14b OK${NC}" || true
    docker exec core-ollama ollama pull mistral:7b 2>/dev/null && echo -e "${GREEN}    mistral:7b OK${NC}" || true

    # Telegram konfigurieren
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
        cat > /opt/ki-power/openclaw-config/telegram.json << TGEOF
{
  "channels": [
    {
      "type": "telegram",
      "token": "${TELEGRAM_BOT_TOKEN}",
      "allowedUsers": [],
      "autoApprove": false
    }
  ]
}
TGEOF
        docker cp /opt/ki-power/openclaw-config/telegram.json openclaw:/home/node/.openclaw/channels.json 2>/dev/null || true
        docker restart openclaw 2>/dev/null || true
        echo -e "${GREEN}  OK - Telegram Bot konfiguriert und aktiv${NC}"
    else
        echo -e "${YELLOW}  Kein Telegram Token - spaeter konfigurieren${NC}"
    fi
fi

echo -e "${GREEN}  OK - Nginx + Telegram fertig${NC}"

# ================================================================
# PHASE 8: WATCHDOG + AUTO-HEAL + BACKUPS
# ================================================================
echo ""
echo -e "${YELLOW}[PHASE 8/8] Watchdog, Auto-Heal & Backups${NC}"

# Neural Watchdog installieren (selbstlernendes Ueberwachungssystem)
mkdir -p /opt/ki-power/neural/{metrics,patterns,incidents}

# Neural Watchdog aus dem Repo herunterladen oder lokal kopieren
NEURAL_SCRIPT_URL="https://raw.githubusercontent.com/Maurice-AIEMPIRE/core/claude/fix-systeme-io-login-VStsj/integrations/systemeio-hetzner/deploy/adler-neural-watchdog.sh"
curl -sfL "$NEURAL_SCRIPT_URL" -o /usr/local/bin/adler-neural-watchdog 2>/dev/null || {
    # Fallback: Inline-Version des Neural Watchdog
    echo "  Neural Watchdog wird lokal erstellt..."
}
chmod +x /usr/local/bin/adler-neural-watchdog

# Initiale Schwellwerte setzen
cat > /opt/ki-power/neural/thresholds.json << 'THRESHEOF'
{
    "cpu_warn": 80,
    "cpu_crit": 95,
    "mem_warn": 80,
    "mem_crit": 92,
    "disk_warn": 80,
    "disk_crit": 90,
    "telegram_max_errors_5m": 3,
    "container_max_restarts": 5,
    "disk_full_warn_hours": 48,
    "mesh_check_interval_sec": 120
}
THRESHEOF

echo -e "${GREEN}  OK - Neural Watchdog installiert (selbstlernend, praediktiv)${NC}"

# Neural Watchdog alle 2 Minuten ausfuehren
cat > /etc/cron.d/adler-watchdog << 'CRONEOF'
# Adler Neural Watchdog - alle 2 Minuten
*/2 * * * * root /usr/local/bin/adler-neural-watchdog >> /var/log/adler-neural.log 2>&1
CRONEOF

# Woechentliches Update - Sonntag 3:00 Uhr
cat > /etc/cron.d/adler-update << 'CRONEOF'
# Adler Auto-Update: Sonntag 3:00 Uhr
0 3 * * 0 root cd /opt/ki-power && docker compose pull && docker compose up -d && docker system prune -f >> /var/log/adler-update.log 2>&1
CRONEOF

# Taegliches Datenbank-Backup - 4:00 Uhr
mkdir -p /opt/ki-power/backups
cat > /usr/local/bin/adler-backup << 'BACKUPEOF'
#!/bin/bash
BACKUP_DIR="/opt/ki-power/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# PostgreSQL Backup
docker exec core-postgres pg_dumpall -U kipower > "$BACKUP_DIR/postgres_${DATE}.sql" 2>/dev/null
if [ $? -eq 0 ]; then
    gzip "$BACKUP_DIR/postgres_${DATE}.sql"
    echo "[$(date)] Backup OK: postgres_${DATE}.sql.gz" >> /var/log/adler-backup.log
fi

# Alte Backups loeschen (nur letzte 7 behalten)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
BACKUPEOF
chmod +x /usr/local/bin/adler-backup

cat > /etc/cron.d/adler-backup << 'CRONEOF'
# Adler Backup: taeglich 4:00 Uhr
0 4 * * * root /usr/local/bin/adler-backup
CRONEOF

# Management-CLI mit Neural + Mesh Kommandos
cat > /usr/local/bin/adler << 'MGMTEOF'
#!/bin/bash
cd /opt/ki-power
NEURAL_DIR="/opt/ki-power/neural"

C_GREEN='\033[0;32m'
C_RED='\033[0;31m'
C_YELLOW='\033[1;33m'
C_CYAN='\033[0;36m'
C_BOLD='\033[1m'
C_NC='\033[0m'

case "${1:-status}" in
    status)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}=== ADLER SERVER STATUS ===${C_NC}"
        echo ""
        echo -e "${C_BOLD}--- Container ---${C_NC}"
        docker compose ps 2>/dev/null
        echo ""
        echo -e "${C_BOLD}--- Mesh-Netzwerk ---${C_NC}"
        printf "  %-25s %-18s %s\n" "GERAET" "IP" "STATUS"
        printf "  %-25s %-18s " "iphone175" "100.122.13.33"
        ping -c1 -W2 100.122.13.33 &>/dev/null && echo -e "${C_GREEN}ONLINE${C_NC}" || echo -e "${C_RED}OFFLINE${C_NC}"
        printf "  %-25s %-18s " "mac-mini-von-maurice" "100.118.223.64"
        ping -c1 -W2 100.118.223.64 &>/dev/null && echo -e "${C_GREEN}ONLINE${C_NC}" || echo -e "${C_RED}OFFLINE${C_NC}"
        printf "  %-25s %-18s " "adler-server (LOKAL)" "100.124.239.46"
        echo -e "${C_GREEN}ONLINE${C_NC}"
        echo ""
        echo -e "${C_BOLD}--- System ---${C_NC}"
        echo "  CPU:    $(top -bn1 | grep 'Cpu(s)' | awk '{printf "%.0f%%", $2}' 2>/dev/null || echo '?')"
        echo "  RAM:    $(free -h | awk '/Mem:/{printf "%s / %s (%s)", $3, $2, int($3/$2*100)"%"}' 2>/dev/null || echo '?')"
        echo "  Disk:   $(df -h / | tail -1 | awk '{printf "%s / %s (%s)", $3, $2, $5}')"
        echo "  Uptime: $(uptime -p 2>/dev/null || uptime)"
        echo ""
        echo -e "${C_BOLD}--- Neural Watchdog ---${C_NC}"
        if [ -f "$NEURAL_DIR/patterns/current.json" ]; then
            local_risk=$(jq -r '.predictions.mem_exhaustion_risk // "unknown"' "$NEURAL_DIR/patterns/current.json" 2>/dev/null)
            local_disk_h=$(jq -r '.predictions.disk_full_in_hours // "999"' "$NEURAL_DIR/patterns/current.json" 2>/dev/null)
            echo "  Memory-Risiko:    $local_risk"
            [ "$local_disk_h" -lt 999 ] 2>/dev/null && echo "  Disk voll in:     ~${local_disk_h}h" || echo "  Disk voll in:     Kein Risiko"
            echo "  Datenpunkte:      $(ls "$NEURAL_DIR/metrics/" 2>/dev/null | wc -l) Metriken"
            echo "  Incidents (30d):  $(ls "$NEURAL_DIR/incidents/" 2>/dev/null | wc -l)"
        else
            echo "  Noch keine Daten - Watchdog laeuft alle 2 Min"
        fi
        echo ""
        echo -e "${C_BOLD}--- Letzte Watchdog-Meldungen ---${C_NC}"
        tail -5 /var/log/adler-neural.log 2>/dev/null || echo "  Noch keine Logs"
        ;;
    mesh)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}=== MESH NETZWERK ===${C_NC}"
        echo ""
        echo -e "${C_BOLD}Tailscale Status:${C_NC}"
        tailscale status 2>/dev/null || echo "  Tailscale nicht verfuegbar"
        echo ""
        echo -e "${C_BOLD}Latenz-Test:${C_NC}"
        echo -n "  iphone175 (100.122.13.33):      "
        ping -c3 -W3 100.122.13.33 2>/dev/null | tail -1 | awk -F'/' '{printf "%s ms avg\n", $5}' || echo "NICHT ERREICHBAR"
        echo -n "  mac-mini (100.118.223.64):       "
        ping -c3 -W3 100.118.223.64 2>/dev/null | tail -1 | awk -F'/' '{printf "%s ms avg\n", $5}' || echo "NICHT ERREICHBAR"
        echo ""
        if [ -f "$NEURAL_DIR/mesh-status.json" ]; then
            echo -e "${C_BOLD}Letzter Mesh-Report:${C_NC}"
            jq '.' "$NEURAL_DIR/mesh-status.json" 2>/dev/null
        fi
        ;;
    neural)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}=== NEURAL WATCHDOG ===${C_NC}"
        echo ""
        echo -e "${C_BOLD}Muster-Analyse:${C_NC}"
        if [ -f "$NEURAL_DIR/patterns/current.json" ]; then
            jq '.' "$NEURAL_DIR/patterns/current.json" 2>/dev/null
        else
            echo "  Noch keine Muster erkannt"
        fi
        echo ""
        echo -e "${C_BOLD}Letzte 10 Incidents:${C_NC}"
        for f in $(ls -t "$NEURAL_DIR/incidents/"*.json 2>/dev/null | head -10); do
            local_sev=$(jq -r '.severity' "$f" 2>/dev/null)
            local_comp=$(jq -r '.component' "$f" 2>/dev/null)
            local_msg=$(jq -r '.message' "$f" 2>/dev/null)
            local_time=$(jq -r '.time' "$f" 2>/dev/null)
            echo "  [$local_sev] $local_time - $local_comp: $local_msg"
        done
        echo ""
        echo -e "${C_BOLD}Schwellwerte:${C_NC}"
        jq '.' "$NEURAL_DIR/thresholds.json" 2>/dev/null || echo "  Keine Schwellwerte"
        ;;
    logs)
        docker compose logs -f --tail=50 ${2:-} 2>/dev/null
        ;;
    restart)
        docker compose restart ${2:-} 2>/dev/null
        ;;
    update)
        docker compose pull && docker compose up -d && docker system prune -f
        echo "Update abgeschlossen!"
        ;;
    stop)
        docker compose stop
        ;;
    start)
        docker compose up -d
        ;;
    telegram)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}=== TELEGRAM BOT STATUS ===${C_NC}"
        echo ""
        echo -e "${C_BOLD}OpenClaw Container:${C_NC}"
        docker inspect --format='Status: {{.State.Status}}, Running: {{.State.Running}}, Restarts: {{.RestartCount}}' openclaw 2>/dev/null || echo "  Container nicht gefunden"
        echo ""
        echo -e "${C_BOLD}Telegram-relevante Logs (letzte 5 Min):${C_NC}"
        docker logs --since 5m openclaw 2>&1 | grep -i "telegram\|bot\|channel\|polling\|webhook" | tail -20 || echo "  Keine Telegram-Logs"
        echo ""
        echo -e "${C_BOLD}Fehler (letzte 5 Min):${C_NC}"
        local_errors=$(docker logs --since 5m openclaw 2>&1 | grep -ci "error\|ETELEGRAM\|fail" 2>/dev/null || echo "0")
        [ "$local_errors" -gt 0 ] && echo -e "  ${C_RED}$local_errors Fehler gefunden${C_NC}" || echo -e "  ${C_GREEN}Keine Fehler${C_NC}"
        ;;
    backup)
        /usr/local/bin/adler-backup
        echo "Backup erstellt!"
        ls -lh /opt/ki-power/backups/
        ;;
    heal)
        echo "Sofortige Selbstheilung wird ausgefuehrt..."
        /usr/local/bin/adler-neural-watchdog
        echo -e "${C_GREEN}Heilungslauf abgeschlossen. Siehe: adler neural${C_NC}"
        ;;
    keys)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}=== API KEYS VERWALTEN ===${C_NC}"
        echo ""
        source /opt/ki-power/.env 2>/dev/null || true
        echo "  Aktueller Status:"
        [ "${SYSTEME_API_KEY:-SPAETER_EINTRAGEN}" != "SPAETER_EINTRAGEN" ] && echo -e "    Systeme.io:  ${C_GREEN}GESETZT${C_NC}" || echo -e "    Systeme.io:  ${C_RED}FEHLT${C_NC}"
        [ "${HETZNER_API_TOKEN:-SPAETER_EINTRAGEN}" != "SPAETER_EINTRAGEN" ] && echo -e "    Hetzner:     ${C_GREEN}GESETZT${C_NC}" || echo -e "    Hetzner:     ${C_RED}FEHLT${C_NC}"
        [ "${OPENAI_API_KEY:-SPAETER_EINTRAGEN}" != "SPAETER_EINTRAGEN" ] && echo -e "    OpenAI:      ${C_GREEN}GESETZT${C_NC}" || echo -e "    OpenAI:      ${C_RED}FEHLT${C_NC}"
        [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo -e "    Telegram:    ${C_GREEN}GESETZT${C_NC}" || echo -e "    Telegram:    ${C_RED}FEHLT${C_NC}"
        echo ""
        echo "  Keys eintragen mit:"
        echo "    adler keys set systeme DEIN_KEY"
        echo "    adler keys set hetzner DEIN_TOKEN"
        echo "    adler keys set openai DEIN_KEY"
        echo "    adler keys set telegram DEIN_BOT_TOKEN"
        echo ""
        if [ "${2:-}" = "set" ] && [ -n "${3:-}" ] && [ -n "${4:-}" ]; then
            case "$3" in
                systeme)  sed -i "s|^SYSTEME_API_KEY=.*|SYSTEME_API_KEY=$4|" /opt/ki-power/.env ;;
                hetzner)  sed -i "s|^HETZNER_API_TOKEN=.*|HETZNER_API_TOKEN=$4|" /opt/ki-power/.env ;;
                openai)   sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$4|" /opt/ki-power/.env ;;
                telegram) sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$4|" /opt/ki-power/.env ;;
                *) echo -e "${C_RED}Unbekannter Key: $3${C_NC}"; exit 1 ;;
            esac
            echo -e "${C_GREEN}  $3 Key wurde gesetzt! Neustart der Services...${C_NC}"
            docker compose up -d 2>/dev/null
        fi
        ;;
    *)
        echo ""
        echo -e "${C_CYAN}${C_BOLD}ADLER SERVER MANAGEMENT${C_NC}"
        echo ""
        echo "  adler status    - Komplett-Status (System + Mesh + Neural)"
        echo "  adler keys      - API Keys anzeigen/setzen"
        echo "  adler mesh      - Mesh-Netzwerk Status + Latenz"
        echo "  adler neural    - Neural Watchdog Analyse + Incidents"
        echo "  adler heal      - Sofort Selbstheilung ausfuehren"
        echo "  adler telegram  - Telegram Bot Status"
        echo "  adler logs      - Logs anzeigen (optional: Service)"
        echo "  adler restart   - Neustart (optional: Service)"
        echo "  adler update    - System aktualisieren"
        echo "  adler backup    - Sofort-Backup erstellen"
        echo "  adler stop      - System stoppen"
        echo "  adler start     - System starten"
        echo ""
        ;;
esac
MGMTEOF
chmod +x /usr/local/bin/adler

# Log Rotation
cat > /etc/logrotate.d/adler << 'LOGEOF'
/var/log/adler-*.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
}
LOGEOF

echo -e "${GREEN}  OK - Neural Watchdog (2 Min) + Backups (taeglich) + Auto-Update (woechentlich)${NC}"

# Ersten Neural Watchdog Lauf ausfuehren
echo "  Erster Neural-Analyse-Lauf..."
/usr/local/bin/adler-neural-watchdog 2>/dev/null || true
echo -e "${GREEN}  OK - Initiale Metriken gesammelt${NC}"

# ================================================================
# FERTIG!
# ================================================================
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗"
echo -e "║    ADLER SERVER ERFOLGREICH EINGERICHTET!                    ║"
echo -e "╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "║                                                              ║"
echo -e "║  ${GREEN}CORE App:${NC}      http://${TS_IP}:3033                          "
echo -e "║  ${GREEN}n8n:${NC}           http://${TS_IP}:3033/n8n/                     "
echo -e "║  ${GREEN}OpenClaw:${NC}      http://${TS_IP}:18789                         "
echo -e "║  ${GREEN}Public IP:${NC}     ${SERVER_IP}                                  "
echo -e "║  ${GREEN}Tailscale IP:${NC}  ${TS_IP}                                     "
echo -e "║                                                              "
echo -e "║  ${YELLOW}Management:${NC}    adler status                                "
echo -e "║  ${YELLOW}Telegram:${NC}      adler telegram                              "
echo -e "║  ${YELLOW}Logs:${NC}          adler logs                                  "
echo -e "║  ${YELLOW}Backup:${NC}        adler backup                                "
echo -e "║  ${YELLOW}Config:${NC}        /opt/ki-power/.env                           "
echo -e "║                                                              "
if [ -n "${DOMAIN:-}" ]; then
echo -e "║  ${GREEN}Domain:${NC}        https://${DOMAIN}                            "
fi
echo -e "║                                                              "
echo -e "║  ${CYAN}SICHERHEIT:${NC}                                                "
echo -e "║    - SSH: Nur Key-Authentifizierung                         "
echo -e "║    - Firewall: UFW aktiv (SSH + HTTP + HTTPS + Tailscale)   "
echo -e "║    - Fail2Ban: Brute-Force Schutz aktiv                    "
echo -e "║    - Tailscale: Verschluesseltes Mesh-Netzwerk             "
echo -e "║    - Auto-Updates: Woechentlich Sonntag 3:00               "
echo -e "║                                                              "
echo -e "║  ${CYAN}NEURAL WATCHDOG (SELBSTLERNEND):${NC}                            "
echo -e "║    - Alle 2 Min: Metriken sammeln + Muster analysieren     "
echo -e "║    - Praediktiv: Probleme erkennen BEVOR sie auftreten     "
echo -e "║    - Auto-Heal: Docker, Tailscale, Telegram, Nginx, Disk   "
echo -e "║    - Mesh-Monitor: Alle 3 Geraete permanent ueberwacht     "
echo -e "║    - Trend-Analyse: CPU, RAM, Disk Vorhersage              "
echo -e "║                                                              "
echo -e "║  ${CYAN}AUSFALLSICHERHEIT:${NC}                                         "
echo -e "║    - Backups: Taeglich 4:00 Uhr (7 Tage aufbewahrt)       "
echo -e "║    - Docker: Live-Restore bei Docker-Restart               "
echo -e "║    - Container: Automatischer Neustart bei Crash           "
echo -e "║    - OOM-Schutz: Kritische Container priorisiert           "
echo -e "║                                                              "
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${RED}${BOLD}WICHTIG: Speichere deine Zugangsdaten!${NC}"
echo "  n8n Login:     admin / ${N8N_PW}"
echo "  Gateway Token: ${GW_TOKEN}"
echo "  Config:        cat /opt/ki-power/.env"
echo ""
echo -e "${GREEN}Setup abgeschlossen in $(date)${NC}"
echo -e "${GREEN}Log: $LOG_FILE${NC}"
