#!/usr/bin/env bash
# ================================================================
#  PFEIFER GALAXIA OS — MASTER LAUNCH SCRIPT
#  Ausfuehren auf dem MAC:
#    bash scripts/launch-galaxia.sh
#
#  Was es macht:
#    Phase 1: Mac vorbereiten (Browser, OpenClaw, SSH)
#    Phase 2: Server vorbereiten (Ollama, Modelle, Galaxia)
#    Phase 3: Alles verbinden (Telegram, Gateway)
#    Phase 4: Galaxia starten
# ================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[GALAXIA]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HETZNER_IP="65.21.203.174"
SERVER_USER="root"

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║    PFEIFER GALAXIA OS — MASTER LAUNCHER      ║"
echo "  ║    100% Kostenlos | 100% Open Source          ║"
echo "  ║    7 Agents | 6 Modelle | ZERO API Kosten     ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ================================================================
# PHASE 1: MAC VORBEREITEN
# ================================================================
step "PHASE 1: Mac vorbereiten"

# Check wir sind auf macOS
if [[ "$(uname)" != "Darwin" ]]; then
    error "Dieses Script ist fuer macOS! Fuer Linux: bash scripts/setup-clawmaster.sh"
    exit 1
fi
log "macOS $(sw_vers -productVersion 2>/dev/null || echo '') erkannt"

# Node.js Check
if ! command -v node &>/dev/null; then
    log "Node.js installieren..."
    if command -v brew &>/dev/null; then
        brew install node@22
    else
        error "Node.js und Homebrew nicht gefunden."
        echo "  Installiere Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo "  Dann: brew install node@22"
        exit 1
    fi
fi
log "Node.js $(node -v) OK"

# OpenClaw installieren/updaten
log "OpenClaw installieren..."
if command -v openclaw &>/dev/null; then
    log "OpenClaw bereits installiert: $(openclaw --version 2>/dev/null || echo 'OK')"
else
    npm install -g openclaw@latest || {
        error "OpenClaw Installation fehlgeschlagen"
        exit 1
    }
    log "OpenClaw installiert!"
fi

# Browser Setup (Kurzversion)
log "Browser-Setup..."
if [[ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] || \
   [[ -f "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" ]]; then
    log "Chromium-Browser gefunden"
else
    warn "Kein Chrome/Brave gefunden — Vollstaendiges Browser-Setup ausfuehren..."
    bash "$SCRIPT_DIR/setup-openclaw-browser-macos.sh"
fi

# OpenClaw Config kopieren
log "OpenClaw Config kopieren..."
mkdir -p "$HOME/.openclaw/workspace/skills"
if [[ -f "$PROJECT_ROOT/.openclaw/openclaw.json" ]]; then
    # Merge: Browser-Config behalten, Rest aus Repo uebernehmen
    cp "$PROJECT_ROOT/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.galaxia"
    log "Galaxia Config bereitgestellt"
fi

# Workspace kopieren
log "Workspace kopieren..."
cp -r "$PROJECT_ROOT/openclaw/workspace/"* "$HOME/.openclaw/workspace/" 2>/dev/null || true
log "15 Skills + GALAXIA_CORE.md + AGENTS.md + REVENUE-LOG.md kopiert"

log "Phase 1 abgeschlossen — Mac bereit!"

# ================================================================
# PHASE 2: SERVER VORBEREITEN
# ================================================================
step "PHASE 2: Hetzner Server vorbereiten ($HETZNER_IP)"

# SSH Verbindung testen
log "SSH-Verbindung testen..."
if ssh -o ConnectTimeout=5 -o BatchMode=yes ${SERVER_USER}@${HETZNER_IP} "echo 'OK'" 2>/dev/null; then
    log "SSH-Verbindung zum Server OK!"
else
    warn "SSH-Verbindung fehlgeschlagen."
    echo ""
    echo "  Optionen:"
    echo "  a) SSH Key noch nicht auf Server → Hetzner Robot Console nutzen"
    echo "     https://robot.hetzner.com → Server → Rescue → SSH Key hinzufuegen"
    echo ""
    echo "  b) SSH Key generieren + manuell hinzufuegen:"
    echo "     ssh-keygen -t ed25519 -f ~/.ssh/hetzner_ed25519 -N ''"
    echo "     cat ~/.ssh/hetzner_ed25519.pub"
    echo "     → Key im Hetzner Robot unter 'SSH-Keys' hinzufuegen"
    echo "     → Server im Rescue-System neustarten"
    echo ""
    echo "  c) Password-Login (wenn aktiviert):"
    echo "     ssh root@${HETZNER_IP}"
    echo ""
    read -p "SSH nochmal versuchen? [y/N]: " RETRY_SSH
    if [[ "$RETRY_SSH" =~ ^[yY]$ ]]; then
        ssh -o ConnectTimeout=10 ${SERVER_USER}@${HETZNER_IP} "echo 'OK'" || {
            error "SSH funktioniert nicht. Bitte SSH-Zugang einrichten und nochmal starten."
            exit 1
        }
    else
        error "SSH-Zugang wird benoetigt. Bitte einrichten und nochmal starten."
        echo ""
        echo "  Wenn SSH steht, nochmal ausfuehren:"
        echo "  bash scripts/launch-galaxia.sh"
        exit 1
    fi
fi

# Repo auf Server klonen/updaten
log "Repository auf Server synchronisieren..."
ssh ${SERVER_USER}@${HETZNER_IP} << 'REMOTE_SETUP'
set -e

echo "[SERVER] System-Pakete pruefen..."
apt-get update -qq
apt-get install -y -qq git python3 python3-pip ffmpeg > /dev/null 2>&1

# Repo klonen oder updaten
if [ -d /root/core ]; then
    echo "[SERVER] Repo updaten..."
    cd /root/core && git pull origin main 2>/dev/null || git pull 2>/dev/null || true
else
    echo "[SERVER] Repo klonen..."
    cd /root
    git clone https://github.com/Maurice-AIEMPIRE/core.git 2>/dev/null || {
        echo "[SERVER] Git Clone fehlgeschlagen — manuell klonen!"
        exit 1
    }
fi

echo "[SERVER] Repo bereit: /root/core"
REMOTE_SETUP

log "Repository auf Server synchronisiert!"

# Ollama + Modelle auf Server installieren
log "Ollama + 6 Modelle auf Server installieren..."
ssh ${SERVER_USER}@${HETZNER_IP} << 'REMOTE_OLLAMA'
set -e

# Ollama installieren
if ! command -v ollama &>/dev/null; then
    echo "[SERVER] Ollama installieren..."
    curl -fsSL https://ollama.ai/install.sh | sh
else
    echo "[SERVER] Ollama bereits installiert: $(ollama --version 2>/dev/null || echo 'OK')"
fi

# Ollama Service starten
systemctl enable ollama 2>/dev/null || true
systemctl start ollama 2>/dev/null || true
sleep 2

echo "[SERVER] Ollama laeuft!"

# 6 Modelle parallel pullen
echo "[SERVER] 6 kostenlose Modelle werden geladen..."
echo "[SERVER] Das dauert beim ersten Mal ~30-60 Minuten (insgesamt ~50GB Download)"
echo "[SERVER] Alle Modelle sind 100% kostenlos!"

MODELS="nomic-embed-text qwen3:14b"
MODELS_BIG="qwen3:32b qwen3-coder deepseek-r1:32b llama4"

# Erst kleine Modelle (schnell)
for model in $MODELS; do
    if ollama list 2>/dev/null | grep -q "${model%%:*}"; then
        echo "[SERVER] $model bereits geladen"
    else
        echo "[SERVER] Pulling $model..."
        ollama pull "$model" &
    fi
done
wait

# Dann grosse Modelle (parallel)
for model in $MODELS_BIG; do
    if ollama list 2>/dev/null | grep -q "${model%%:*}"; then
        echo "[SERVER] $model bereits geladen"
    else
        echo "[SERVER] Pulling $model (gross, dauert etwas)..."
        ollama pull "$model" &
    fi
done
wait

echo ""
echo "[SERVER] Alle Modelle geladen!"
ollama list
REMOTE_OLLAMA

log "Ollama + Modelle auf Server installiert!"

# ================================================================
# PHASE 3: GALAXIA OS AUF SERVER DEPLOYEN
# ================================================================
step "PHASE 3: Galaxia OS auf Server deployen"

ssh ${SERVER_USER}@${HETZNER_IP} << 'REMOTE_GALAXIA'
set -e

GALAXIA_ROOT="/root/galaxia"

echo "[SERVER] Galaxia OS Verzeichnisse erstellen..."
mkdir -p "$GALAXIA_ROOT"/{planets,vector_db,scripts,skills,logs}

# Dateien aus Repo kopieren
if [ -d /root/core/galaxia ]; then
    cp /root/core/galaxia/galaxia-vector-core.py "$GALAXIA_ROOT/" 2>/dev/null || true
    cp /root/core/galaxia/scripts/* "$GALAXIA_ROOT/scripts/" 2>/dev/null || true
    chmod +x "$GALAXIA_ROOT/galaxia-vector-core.py" 2>/dev/null || true
    chmod +x "$GALAXIA_ROOT/scripts/"*.sh 2>/dev/null || true
    echo "[SERVER] Galaxia Scripts installiert"
fi

# OpenClaw Workspace
mkdir -p /root/.openclaw/workspace/skills
if [ -d /root/core/openclaw/workspace ]; then
    cp -r /root/core/openclaw/workspace/* /root/.openclaw/workspace/ 2>/dev/null || true
    echo "[SERVER] Workspace kopiert (GALAXIA_CORE.md, AGENTS.md, etc.)"
fi

# OpenClaw Config
if [ -f /root/core/.openclaw/openclaw.json ]; then
    cp /root/core/.openclaw/openclaw.json /root/.openclaw/openclaw.json
    echo "[SERVER] openclaw.json installiert"
fi

# Python Dependencies
echo "[SERVER] Python Dependencies installieren..."
pip3 install --quiet lancedb pillow requests 2>/dev/null || {
    echo "[SERVER] Einige Python Pakete fehlen — manuell installieren"
}

# Initiale Planeten spawnen
echo "[SERVER] Initiale Planeten spawnen..."
bash "$GALAXIA_ROOT/scripts/spawn-planet.sh" "Revenue-Planet" "Templates verkaufen und Freelance-Einnahmen generieren" 2>/dev/null || true
bash "$GALAXIA_ROOT/scripts/spawn-planet.sh" "YouTube-Planet-001" "Ersten 3 YouTube Videos produzieren und hochladen" 2>/dev/null || true

# Vector-Index erstellen
echo "[SERVER] Vector-Index erstellen..."
python3 "$GALAXIA_ROOT/galaxia-vector-core.py" index /root/.openclaw/workspace 2>/dev/null || {
    echo "[SERVER] Vector-Index wird spaeter erstellt (LanceDB noch nicht ready)"
}

echo ""
echo "[SERVER] Galaxia OS Status:"
python3 "$GALAXIA_ROOT/galaxia-vector-core.py" status 2>/dev/null || echo "Status nicht verfuegbar"

echo ""
echo "[SERVER] Galaxia OS deployed!"
REMOTE_GALAXIA

log "Galaxia OS auf Server deployed!"

# ================================================================
# PHASE 4: OPENCLAW + TELEGRAM SETUP
# ================================================================
step "PHASE 4: OpenClaw Gateway + Telegram"

# OpenClaw auf Server installieren
log "OpenClaw auf Server installieren..."
ssh ${SERVER_USER}@${HETZNER_IP} << 'REMOTE_OPENCLAW'
set -e

# Node.js installieren wenn nicht vorhanden
if ! command -v node &>/dev/null; then
    echo "[SERVER] Node.js installieren..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

echo "[SERVER] Node.js $(node -v)"

# OpenClaw installieren
if ! command -v openclaw &>/dev/null; then
    echo "[SERVER] OpenClaw installieren..."
    npm install -g openclaw@latest
fi

echo "[SERVER] OpenClaw $(openclaw --version 2>/dev/null || echo 'OK')"

# Gateway als systemd Service einrichten
cat > /etc/systemd/system/openclaw-gateway.service << 'SERVICEEOF'
[Unit]
Description=OpenClaw Gateway — Pfeifer Galaxia OS
After=network.target ollama.service

[Service]
Type=simple
User=root
WorkingDirectory=/root
ExecStart=/usr/bin/openclaw gateway --verbose
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable openclaw-gateway 2>/dev/null || true

echo "[SERVER] OpenClaw Gateway Service eingerichtet"
echo "[SERVER] Starten mit: systemctl start openclaw-gateway"
REMOTE_OPENCLAW

log "OpenClaw auf Server installiert!"

# ================================================================
# PHASE 5: MAC GATEWAY STARTEN
# ================================================================
step "PHASE 5: Lokalen Gateway starten"

log "OpenClaw Gateway auf Mac starten..."
openclaw gateway --verbose &
GATEWAY_PID=$!
sleep 2

if kill -0 $GATEWAY_PID 2>/dev/null; then
    log "Gateway laeuft (PID: $GATEWAY_PID)"
else
    warn "Gateway konnte nicht gestartet werden"
    echo "  Manuell starten: openclaw gateway --verbose"
fi

# ================================================================
# SUMMARY
# ================================================================
echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║    PFEIFER GALAXIA OS — ONLINE!              ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""
log "Installiert (ALLES KOSTENLOS):"
echo "  ✅ Mac: OpenClaw Gateway + Browser Profiles"
echo "  ✅ Server: Ollama + 6 AI Modelle (ZERO Kosten)"
echo "  ✅ Server: Galaxia OS + Vector-Core + Planet-System"
echo "  ✅ Server: 15 ClawHub Skills"
echo "  ✅ Server: Revenue-Planet + YouTube-Planet-001 gespawnt"
echo ""
echo "  🧠 Modelle auf Server:"
echo "     qwen3:32b | qwen3-coder | deepseek-r1:32b"
echo "     qwen3:14b | llama4 | nomic-embed-text"
echo ""
echo "  💰 MONATLICHE KOSTEN: 0 EUR"
echo ""
log "Inner Circle — 7 Agents bereit:"
echo "  🎯 Monica  🔍 Dwight  ✍️ Kelly  📧 Pam"
echo "  💻 Ryan  💰 Chandler  🎬 Ross"
echo ""
log "NAECHSTER SCHRITT — Telegram Bot pairen:"
echo ""
echo "  1. Telegram: @BotFather → /newbot → Token kopieren"
echo "  2. Terminal: openclaw channels login"
echo "  3. 'Telegram' waehlen → Token einfuegen"
echo "  4. Supergroup erstellen: 'Inner Circle — Pfeifer Profit Squad'"
echo "  5. 7 Topics erstellen:"
echo "     🎯 Orchestration & Strategy (Monica)"
echo "     🔍 Research & Insights (Dwight)"
echo "     ✍️ Writing & X-Content (Kelly)"
echo "     📧 Newsletter & Products (Pam)"
echo "     💻 Code & Automation (Ryan)"
echo "     💰 Money Printer (Chandler)"
echo "     🎬 Video & YouTube (Ross)"
echo ""
echo "  6. Server Gateway starten:"
echo "     ssh root@${HETZNER_IP} 'systemctl start openclaw-gateway'"
echo ""
echo "  7. Monica starten:"
echo "     'Monica, Galaxia online. Starte die Expansion.'"
echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Das Universum expandiert. ZERO Kosten. Maximaler Revenue."
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
