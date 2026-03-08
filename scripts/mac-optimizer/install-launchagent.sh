#!/usr/bin/env bash
# =============================================================================
# install-launchagent.sh
# Installiert den Mac-Performance-Optimizer als automatischen LaunchAgent.
# Der LaunchAgent läuft beim Login und stündlich im Hintergrund.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_SCRIPT="$SCRIPT_DIR/mac-performance-fix.sh"
PLIST_TEMPLATE="$SCRIPT_DIR/com.core.mac-optimizer.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS_DIR/com.core.mac-optimizer.plist"
LABEL="com.core.mac-optimizer"

# --- Farben ------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

echo ""
echo "=============================================="
echo " Mac Performance Optimizer – Installation"
echo "=============================================="
echo ""

# --- Voraussetzungen prüfen --------------------------------------------------
[[ "$(uname)" == "Darwin" ]] || err "Nur für macOS geeignet."
[[ -f "$FIX_SCRIPT" ]]       || err "Skript nicht gefunden: $FIX_SCRIPT"
[[ -f "$PLIST_TEMPLATE" ]]   || err "Plist-Vorlage nicht gefunden: $PLIST_TEMPLATE"

# --- Skript ausführbar machen ------------------------------------------------
chmod +x "$FIX_SCRIPT"
ok "Skript als ausführbar markiert: $FIX_SCRIPT"

# --- LaunchAgents-Ordner anlegen ---------------------------------------------
mkdir -p "$LAUNCH_AGENTS_DIR"

# --- Plist mit echten Pfaden befüllen ----------------------------------------
sed \
    -e "s|SCRIPT_PATH_PLACEHOLDER|$FIX_SCRIPT|g" \
    -e "s|HOME_PLACEHOLDER|$HOME|g" \
    "$PLIST_TEMPLATE" > "$PLIST_DEST"
ok "LaunchAgent-Plist installiert: $PLIST_DEST"

# --- Bestehenden Agent entladen (falls vorhanden) ----------------------------
if launchctl list "$LABEL" &>/dev/null; then
    warn "Bestehender LaunchAgent gefunden – wird neu geladen..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# --- Agent laden -------------------------------------------------------------
launchctl load "$PLIST_DEST"
ok "LaunchAgent geladen: $LABEL"

echo ""
echo "=============================================="
echo " Installation abgeschlossen!"
echo ""
echo " Der Optimizer läuft jetzt:"
echo "   - Beim nächsten Login automatisch"
echo "   - Stündlich im Hintergrund"
echo ""
echo " Logs:     ~/Library/Logs/mac-optimizer/"
echo " Entfernen: ./uninstall-launchagent.sh"
echo ""
echo " Jetzt sofort ausführen:"
echo "   bash $FIX_SCRIPT"
echo "=============================================="
echo ""
