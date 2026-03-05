#!/bin/bash
set -euo pipefail

# ============================================================
# KI-POWER DIGITAL FAST FOOD SYSTEM
# Automatisches Server-Setup fuer Hetzner
# ============================================================
# Ausfuehren: bash setup.sh
# ============================================================

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/ki-power"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     KI-POWER DIGITAL FAST FOOD SYSTEM                   ║"
echo "║     Automatisches Server-Setup                           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================================
# 1. API KEYS ABFRAGEN
# ============================================================
echo -e "${YELLOW}[1/6] API Keys Konfiguration${NC}"
echo ""

# Pruefen ob .env schon existiert
if [ -f "$INSTALL_DIR/.env" ]; then
    echo -e "${GREEN}Bestehende .env Konfiguration gefunden.${NC}"
    read -p "Bestehende Konfiguration verwenden? (j/n): " USE_EXISTING
    if [ "$USE_EXISTING" = "j" ]; then
        source "$INSTALL_DIR/.env"
    fi
fi

if [ -z "${SYSTEME_API_KEY:-}" ]; then
    echo -e "${BLUE}Systeme.io API Key:${NC}"
    echo "  → Dashboard → Settings → API Keys → Create"
    read -p "  Dein Systeme.io API Key: " SYSTEME_API_KEY
    if [ -z "$SYSTEME_API_KEY" ]; then
        echo -e "${RED}Fehler: Systeme.io API Key ist erforderlich!${NC}"
        exit 1
    fi
fi

if [ -z "${HETZNER_API_TOKEN:-}" ]; then
    echo -e "${BLUE}Hetzner Cloud API Token:${NC}"
    echo "  → console.hetzner.cloud → Security → API Tokens → Generate"
    read -p "  Dein Hetzner API Token: " HETZNER_API_TOKEN
    if [ -z "$HETZNER_API_TOKEN" ]; then
        echo -e "${RED}Fehler: Hetzner API Token ist erforderlich!${NC}"
        exit 1
    fi
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo -e "${BLUE}OpenAI API Key:${NC}"
    echo "  → platform.openai.com/api-keys"
    read -p "  Dein OpenAI API Key: " OPENAI_API_KEY
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${RED}Fehler: OpenAI API Key ist erforderlich!${NC}"
        exit 1
    fi
fi

# Optionale Domain
echo ""
echo -e "${BLUE}Domain fuer SSL (optional, Enter zum Ueberspringen):${NC}"
echo "  z.B. ki-power.deine-domain.de"
read -p "  Domain: " DOMAIN
DOMAIN="${DOMAIN:-}"

echo -e "${GREEN}  ✓ API Keys konfiguriert${NC}"
echo ""

# ============================================================
# 2. SYSTEM-PAKETE INSTALLIEREN
# ============================================================
echo -e "${YELLOW}[2/6] System-Pakete installieren...${NC}"

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get upgrade -y -qq

apt-get install -y -qq \
    curl wget git unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates gnupg lsb-release \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban \
    jq htop

echo -e "${GREEN}  ✓ System-Pakete installiert${NC}"

# ============================================================
# 3. DOCKER INSTALLIEREN
# ============================================================
echo -e "${YELLOW}[3/6] Docker installieren...${NC}"

if command -v docker &> /dev/null; then
    echo -e "${GREEN}  ✓ Docker ist bereits installiert$(docker --version)${NC}"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}  ✓ Docker installiert$(docker --version)${NC}"
fi

if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
    echo -e "${GREEN}  ✓ Docker Compose ist bereits installiert${NC}"
else
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}  ✓ Docker Compose installiert${NC}"
fi

# ============================================================
# 4. FIREWALL & SICHERHEIT
# ============================================================
echo -e "${YELLOW}[4/6] Firewall & Sicherheit konfigurieren...${NC}"

# UFW Firewall
ufw default deny incoming 2>/dev/null || true
ufw default allow outgoing 2>/dev/null || true
ufw allow 22/tcp 2>/dev/null || true
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

# Fail2Ban
systemctl enable fail2ban 2>/dev/null || true
systemctl start fail2ban 2>/dev/null || true

echo -e "${GREEN}  ✓ Firewall aktiv (SSH, HTTP, HTTPS)${NC}"
echo -e "${GREEN}  ✓ Fail2Ban aktiv${NC}"

# ============================================================
# 5. KI-POWER APP DEPLOYEN
# ============================================================
echo -e "${YELLOW}[5/6] KI-Power System deployen...${NC}"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Sichere Passwoerter generieren
generate_secret() {
    openssl rand -hex 16
}

DB_PASSWORD=$(generate_secret)
NEO4J_PASS=$(generate_secret)
SESSION=$(generate_secret)
ENCRYPT=$(generate_secret)
MAGIC=$(generate_secret)

# Server IP ermitteln
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || echo "localhost")

# .env Datei erstellen
cat > "$INSTALL_DIR/.env" << ENVEOF
# KI-POWER DIGITAL FAST FOOD SYSTEM
# Generiert: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Server: ${SERVER_IP}

# API Keys
SYSTEME_API_KEY=${SYSTEME_API_KEY}
HETZNER_API_TOKEN=${HETZNER_API_TOKEN}
OPENAI_API_KEY=${OPENAI_API_KEY}

# App
VERSION=0.4.0
NODE_ENV=production
LOGIN_ORIGIN=http://${SERVER_IP}:3033
APP_ORIGIN=http://${SERVER_IP}:3033

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
ENVEOF

chmod 600 "$INSTALL_DIR/.env"

# Docker Compose Datei erstellen
cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSEEOF'
version: "3.8"

services:
  core:
    container_name: core-app
    image: redplanethq/core:${VERSION:-0.4.0}
    restart: unless-stopped
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

  postgres:
    container_name: core-postgres
    image: pgvector/pgvector:pg18-trixie
    restart: unless-stopped
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
    restart: unless-stopped
    volumes:
      - redis_data:/data
    networks:
      - core

  neo4j:
    container_name: core-neo4j
    image: redplanethq/neo4j:0.1.0
    restart: unless-stopped
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
    restart: unless-stopped
    environment:
      - N8N_HOST=0.0.0.0
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - GENERIC_TIMEZONE=Europe/Berlin
    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
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
COMPOSEEOF

# Docker Images pullen und starten
echo "  Docker Images werden heruntergeladen..."
cd "$INSTALL_DIR"
docker compose pull 2>/dev/null || docker-compose pull
echo "  Container werden gestartet..."
docker compose up -d 2>/dev/null || docker-compose up -d

echo -e "${GREEN}  ✓ Alle Container gestartet${NC}"

# ============================================================
# 6. NGINX REVERSE PROXY
# ============================================================
echo -e "${YELLOW}[6/6] Nginx Reverse Proxy konfigurieren...${NC}"

cat > /etc/nginx/sites-available/ki-power << 'NGINXEOF'
upstream core_app {
    server 127.0.0.1:3033;
}

upstream n8n_app {
    server 127.0.0.1:5678;
}

server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 50M;

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

    location /health {
        access_log off;
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/ki-power /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx

# SSL Setup wenn Domain angegeben
if [ -n "${DOMAIN}" ]; then
    echo "  SSL-Zertifikat wird fuer ${DOMAIN} angefordert..."
    sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/ki-power
    nginx -t && systemctl restart nginx
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "admin@${DOMAIN}" || echo -e "${YELLOW}  SSL-Setup fehlgeschlagen - manuell mit: certbot --nginx -d ${DOMAIN}${NC}"
fi

echo -e "${GREEN}  ✓ Nginx konfiguriert${NC}"

# ============================================================
# AUTO-UPDATE CRON
# ============================================================
cat > /etc/cron.d/ki-power-updates << 'CRONEOF'
# KI-Power Auto-Update: Sonntag 3:00 Uhr
0 3 * * 0 root cd /opt/ki-power && docker compose pull && docker compose up -d && docker system prune -f
CRONEOF

# ============================================================
# MANAGEMENT-SCRIPT
# ============================================================
cat > /usr/local/bin/ki-power << 'MGMTEOF'
#!/bin/bash
cd /opt/ki-power

case "${1:-status}" in
    status)
        echo "=== KI-Power System Status ==="
        docker compose ps 2>/dev/null || docker-compose ps
        echo ""
        echo "=== Disk Usage ==="
        docker system df
        ;;
    logs)
        docker compose logs -f --tail=50 ${2:-} 2>/dev/null || docker-compose logs -f --tail=50 ${2:-}
        ;;
    restart)
        docker compose restart ${2:-} 2>/dev/null || docker-compose restart ${2:-}
        ;;
    update)
        docker compose pull 2>/dev/null || docker-compose pull
        docker compose up -d 2>/dev/null || docker-compose up -d
        docker system prune -f
        echo "Update abgeschlossen!"
        ;;
    stop)
        docker compose stop 2>/dev/null || docker-compose stop
        ;;
    start)
        docker compose up -d 2>/dev/null || docker-compose up -d
        ;;
    *)
        echo "KI-Power Management"
        echo "  ki-power status   - Zeige System-Status"
        echo "  ki-power logs     - Zeige Logs (optional: Service-Name)"
        echo "  ki-power restart  - Neustart (optional: Service-Name)"
        echo "  ki-power update   - System aktualisieren"
        echo "  ki-power stop     - System stoppen"
        echo "  ki-power start    - System starten"
        ;;
esac
MGMTEOF
chmod +x /usr/local/bin/ki-power

# ============================================================
# FERTIG!
# ============================================================
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗"
echo -e "║  ${GREEN}✓ KI-POWER SYSTEM ERFOLGREICH INSTALLIERT!${CYAN}              ║"
echo -e "╠══════════════════════════════════════════════════════════╣"
echo -e "║                                                          ║"
echo -e "║  ${YELLOW}CORE App:${NC}     http://${SERVER_IP}                        "
echo -e "║  ${YELLOW}n8n:${NC}          http://${SERVER_IP}/n8n/                    "
echo -e "║                                                          "
echo -e "║  ${YELLOW}Management:${NC}   ki-power status                            "
echo -e "║  ${YELLOW}Logs:${NC}         ki-power logs                               "
echo -e "║  ${YELLOW}Config:${NC}       /opt/ki-power/.env                          "
echo -e "║                                                          "
if [ -n "${DOMAIN}" ]; then
echo -e "║  ${YELLOW}Domain:${NC}       https://${DOMAIN}                           "
fi
echo -e "║                                                          "
echo -e "║  ${RED}WICHTIG: Notiere dir deine Zugangsdaten!${NC}               "
echo -e "║  ${RED}Die .env Datei enthaelt alle Passwoerter.${NC}              "
echo -e "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Naechste Schritte:${NC}"
echo "  1. Oeffne http://${SERVER_IP} im Browser"
echo "  2. Erstelle deinen Admin-Account"
echo "  3. Richte die Systeme.io Integration ein"
echo "  4. Erstelle deinen ersten Sales Funnel"
echo ""
echo -e "${BLUE}Bei Problemen: ki-power logs${NC}"
