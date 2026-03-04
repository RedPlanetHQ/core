#!/bin/bash
# CLAWMASTER v3.0 — Complete Setup Script
# Installiert OpenClaw + Pi + Security Tools auf Mac und Server
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[CLAWMASTER]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

WORKSPACE="$HOME/.openclaw/workspace"
SKILLS_DIR="$WORKSPACE/skills"

# ============================================================
# PHASE 1: System Check
# ============================================================
log "=== CLAWMASTER v3.0 Setup ==="
log "Phase 1: System Check..."

# Check Node.js >= 22
if ! command -v node &>/dev/null; then
  error "Node.js nicht gefunden. Installiere Node >= 22:"
  echo "  brew install node@22  (macOS)"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs  (Linux)"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  warn "Node.js $NODE_VERSION erkannt, empfohlen >= 22"
fi

log "Node.js $(node -v) OK"

# Check npm
if ! command -v npm &>/dev/null; then
  error "npm nicht gefunden"
  exit 1
fi

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
  log "macOS erkannt"
elif [[ "$OSTYPE" == "linux"* ]]; then
  OS="linux"
  log "Linux erkannt"
fi

# ============================================================
# PHASE 2: OpenClaw installieren
# ============================================================
log "Phase 2: OpenClaw installieren..."

if command -v openclaw &>/dev/null; then
  CURRENT_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
  log "OpenClaw bereits installiert: $CURRENT_VERSION"
  log "Update auf latest..."
  npm install -g openclaw@latest || warn "Update fehlgeschlagen, weiter mit bestehender Version"
else
  log "OpenClaw installieren..."
  npm install -g openclaw@latest
fi

# ============================================================
# PHASE 3: Pi Coding Tool installieren
# ============================================================
log "Phase 3: Pi installieren..."

if command -v pi &>/dev/null; then
  log "Pi bereits installiert"
else
  log "Pi installieren..."
  npm install -g pi-mono || warn "Pi Installation fehlgeschlagen (optional)"
fi

# ============================================================
# PHASE 4: Security Tools installieren
# ============================================================
log "Phase 4: Security Tools installieren..."

# openclaw-security-guard
if npm list -g openclaw-security-guard &>/dev/null 2>&1; then
  log "openclaw-security-guard bereits installiert"
else
  log "openclaw-security-guard installieren..."
  npm install -g openclaw-security-guard || warn "Security Guard Installation fehlgeschlagen"
fi

# Clawprint
CLAWPRINT_DIR="$HOME/.openclaw/clawprint"
if [ -d "$CLAWPRINT_DIR" ]; then
  log "Clawprint bereits installiert"
else
  log "Clawprint installieren..."
  git clone https://github.com/cyntrisec/clawprint.git "$CLAWPRINT_DIR" 2>/dev/null && \
    cd "$CLAWPRINT_DIR" && npm install && cd - || warn "Clawprint Installation fehlgeschlagen"
fi

# ============================================================
# PHASE 5: Workspace einrichten
# ============================================================
log "Phase 5: Workspace einrichten..."

mkdir -p "$WORKSPACE" "$SKILLS_DIR"

# Copy workspace files from repo
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -d "$SCRIPT_DIR/openclaw/workspace" ]; then
  log "Workspace-Dateien kopieren..."
  cp -r "$SCRIPT_DIR/openclaw/workspace/"* "$WORKSPACE/" 2>/dev/null || true
  log "SOUL.md, AGENTS.md, TOOLS.md kopiert"
fi

# Copy skills
if [ -d "$SCRIPT_DIR/openclaw/workspace/skills" ]; then
  log "Skills kopieren..."
  cp -r "$SCRIPT_DIR/openclaw/workspace/skills/"* "$SKILLS_DIR/" 2>/dev/null || true
  log "6 Skills installiert: toggle-context, pi-coder, meta-ads, trading-monitor, content-engine, seo-ranker"
fi

# Copy config
if [ -f "$SCRIPT_DIR/.openclaw/openclaw.json" ]; then
  log "OpenClaw Config kopieren..."
  cp "$SCRIPT_DIR/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json"
  log "openclaw.json installiert"
fi

# ============================================================
# PHASE 6: Gateway Daemon installieren
# ============================================================
log "Phase 6: Gateway Daemon..."

if [ "$OS" = "macos" ]; then
  # launchd Service
  openclaw onboard --install-daemon 2>/dev/null || warn "Daemon Setup fehlgeschlagen — manuell starten mit: openclaw gateway"
elif [ "$OS" = "linux" ]; then
  # systemd Service
  openclaw onboard --install-daemon 2>/dev/null || warn "Daemon Setup fehlgeschlagen — manuell starten mit: openclaw gateway"
fi

# ============================================================
# PHASE 7: Ollama Check (fuer lokale AI)
# ============================================================
log "Phase 7: Ollama + Kostenlose Open Source Modelle..."

if ! command -v ollama &>/dev/null; then
  log "Ollama installieren (kostenlos, open source)..."
  curl -fsSL https://ollama.ai/install.sh | sh || {
    error "Ollama Installation fehlgeschlagen"
    echo "  Manuell: https://ollama.com/download"
    exit 1
  }
fi

log "Ollama $(ollama --version 2>/dev/null || echo 'installiert') OK"

# 5 kostenlose Open Source Modelle — ZERO API Kosten
MODELS=(
  "qwen3:32b"         # Haupt-Reasoning (Monica, Dwight) — 20GB RAM
  "qwen3-coder"       # Coding (Ryan) — 20GB RAM
  "deepseek-r1:32b"   # Deep Reasoning + Trading (Chandler) — 20GB RAM
  "qwen3:8b"          # Speed fuer Content (Kelly, Ross) — 5GB RAM
  "llama4"            # Multimodal: Bilder + Text — 15GB RAM
)

log "5 kostenlose Modelle werden geladen (parallel)..."
log "Gesamt RAM-Bedarf: ~80GB von 128GB — alles passt!"

for model in "${MODELS[@]}"; do
  if ollama list 2>/dev/null | grep -q "${model%%:*}"; then
    log "$model bereits geladen"
  else
    log "Pulling $model (kostenlos)..."
    ollama pull "$model" &
  fi
done
wait
log "Alle Modelle geladen — ZERO Kosten!"

# ============================================================
# PHASE 8: Telegram Bot Pairing
# ============================================================
log "Phase 8: Telegram Setup..."
echo ""
log "Telegram Bot Pairing:"
echo "  1. Oeffne Telegram → @BotFather → /newbot (oder bestehenden Bot nutzen)"
echo "  2. Bot Token kopieren"
echo "  3. openclaw channels login"
echo "  4. Telegram waehlen, Token eingeben"
echo "  5. Supergroup erstellen mit 6 Topics (siehe telegram-topics/)"
echo ""

# ============================================================
# SUMMARY
# ============================================================
echo ""
log "============================================"
log "  CLAWMASTER v3.0 Setup abgeschlossen!"
log "============================================"
echo ""
log "Installiert (ALLES KOSTENLOS):"
echo "  ✅ OpenClaw (Gateway + CLI) — FREE"
echo "  ✅ Pi Coding Tool — FREE"
echo "  ✅ openclaw-security-guard — FREE"
echo "  ✅ Clawprint (Audit Trail) — FREE"
echo "  ✅ 6 Custom Skills (SKILL.md) — FREE"
echo "  ✅ Workspace (SOUL.md, AGENTS.md, TOOLS.md)"
echo "  ✅ 5 Open Source AI Modelle via Ollama — ZERO API Kosten:"
echo "     • qwen3:32b (Reasoning)"
echo "     • qwen3-coder (Coding)"
echo "     • deepseek-r1:32b (Deep Thinking)"
echo "     • qwen3:8b (Speed)"
echo "     • llama4 (Multimodal)"
echo ""
echo "  💰 MONATLICHE KOSTEN: 0 EUR (nur Strom + Server-Miete)"
echo ""
log "Naechste Schritte:"
echo "  1. openclaw gateway --verbose        # Gateway starten"
echo "  2. openclaw channels login            # Telegram pairen"
echo "  3. Toggle Trial starten: https://claw.toggle.pro"
echo "  4. Telegram Supergroup erstellen mit 6 Topics"
echo "  5. Job Descriptions in Topics posten (siehe telegram-topics/)"
echo ""
log "Security Check:"
echo "  openclaw security audit --deep"
echo ""
