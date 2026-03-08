#!/usr/bin/env bash
# =============================================================================
# uninstall-launchagent.sh
# Entfernt den Mac-Performance-Optimizer LaunchAgent vollständig.
# =============================================================================

set -euo pipefail

LABEL="com.core.mac-optimizer"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo ""
echo "=============================================="
echo " Mac Performance Optimizer – Deinstallation"
echo "=============================================="
echo ""

if launchctl list "$LABEL" &>/dev/null; then
    launchctl unload "$PLIST" 2>/dev/null || true
    ok "LaunchAgent entladen: $LABEL"
else
    warn "LaunchAgent war nicht geladen."
fi

if [[ -f "$PLIST" ]]; then
    rm -f "$PLIST"
    ok "Plist entfernt: $PLIST"
else
    warn "Plist nicht gefunden (bereits entfernt?)."
fi

echo ""
ok "Deinstallation abgeschlossen. Logs bleiben unter ~/Library/Logs/mac-optimizer/ erhalten."
echo ""
