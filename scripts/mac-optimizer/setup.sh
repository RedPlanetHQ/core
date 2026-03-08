#!/usr/bin/env bash
# =============================================================================
# setup.sh – Ein-Befehl-Installer für den Mac Performance Auto-Fixer
# Ausführen mit:
#   curl -fsSL https://raw.githubusercontent.com/Maurice-AIEMPIRE/core/claude/auto-fix-mac-performance-Tyo8p/scripts/mac-optimizer/setup.sh | bash
# =============================================================================

set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/Maurice-AIEMPIRE/core/claude/auto-fix-mac-performance-Tyo8p/scripts/mac-optimizer"
INSTALL_DIR="$HOME/.mac-optimizer"
PLIST_DEST="$HOME/Library/LaunchAgents/com.core.mac-optimizer.plist"
LABEL="com.core.mac-optimizer"
LOG_DIR="$HOME/Library/Logs/mac-optimizer"

# --- Farben ------------------------------------------------------------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()      { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
err()     { echo -e "${RED}✗ FEHLER:${NC} $*"; exit 1; }
header()  { echo -e "\n${BOLD}$*${NC}"; }

# --- Voraussetzungen ---------------------------------------------------------
[[ "$(uname)" == "Darwin" ]] || err "Dieses Skript läuft nur auf macOS."

header "================================================"
header " Mac Performance Auto-Fixer – Einrichtung"
header "================================================"
echo ""

# --- Ordner anlegen ----------------------------------------------------------
mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
ok "Installationsordner: $INSTALL_DIR"

# --- Fix-Skript herunterladen ------------------------------------------------
header "1/3 · Skript herunterladen..."
curl -fsSL "$BASE_URL/mac-performance-fix.sh" -o "$INSTALL_DIR/mac-performance-fix.sh"
chmod +x "$INSTALL_DIR/mac-performance-fix.sh"
ok "Skript gespeichert: $INSTALL_DIR/mac-performance-fix.sh"

# --- LaunchAgent-Plist direkt erstellen (kein Template nötig) ----------------
header "2/3 · LaunchAgent einrichten (stündliche Ausführung)..."

cat > "$PLIST_DEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.core.mac-optimizer</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$INSTALL_DIR/mac-performance-fix.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>KeepAlive</key>
    <false/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/launchagent-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/launchagent-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST

# Alten Agent entladen falls vorhanden
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
ok "LaunchAgent aktiv: läuft beim Login + jede Stunde automatisch"

# --- Sofort ausführen --------------------------------------------------------
header "3/3 · Erster Fix-Durchlauf..."
echo ""
bash "$INSTALL_DIR/mac-performance-fix.sh"

# --- Fertig ------------------------------------------------------------------
echo ""
header "================================================"
ok "Einrichtung abgeschlossen!"
echo ""
echo "  Skript:   $INSTALL_DIR/mac-performance-fix.sh"
echo "  Logs:     $LOG_DIR/"
echo ""
echo "  Manuell starten:"
echo "  bash $INSTALL_DIR/mac-performance-fix.sh"
echo ""
echo "  Deinstallieren:"
echo "  launchctl unload $PLIST_DEST && rm $PLIST_DEST && rm -rf $INSTALL_DIR"
header "================================================"
