#!/usr/bin/env bash
# update-check.sh – GitHub Release-Checker

OPTIMIZER_DIR="${OPTIMIZER_DIR:-$HOME/.mac-optimizer}"
REPO="Maurice-AIEMPIRE/core"
BRANCH="claude/auto-fix-mac-performance-Tyo8p"
CHECK_FILE="$OPTIMIZER_DIR/.last_update_check"
CHECK_INTERVAL=86400  # 24h

function get_latest_release() {
    # GitHub API ohne Auth (Rate-Limit: 60 req/h)
    curl -sf "https://api.github.com/repos/$REPO/branches/$BRANCH" 2>/dev/null | \
        grep -o '"sha":"[^"]*"' | head -1 | cut -d'"' -f4
}

function get_current_sha() {
    # Wenn installiert via Homebrew/setup.sh, SHA aus Datei lesen
    cat "$OPTIMIZER_DIR/.installed_sha" 2>/dev/null || echo "unknown"
}

function check_for_update() {
    # Nur 1x pro Tag prüfen
    if [[ -f "$CHECK_FILE" ]]; then
        local last_check
        last_check=$(stat -f %m "$CHECK_FILE" 2>/dev/null || echo 0)
        local now
        now=$(date +%s)
        if (( now - last_check < CHECK_INTERVAL )); then
            return 1  # Kein Update nötig / gerade geprüft
        fi
    fi

    local latest_sha current_sha
    latest_sha=$(get_latest_release)
    current_sha=$(get_current_sha)

    touch "$CHECK_FILE"

    if [[ -z "$latest_sha" ]]; then
        return 1  # API nicht erreichbar
    fi

    if [[ "$current_sha" != "$latest_sha" ]] && [[ "$current_sha" != "unknown" ]]; then
        return 0  # Update verfügbar
    fi

    return 1
}

function show_update_message() {
    cat <<EOF

╔═══════════════════════════════════════════════════════════╗
║          🚀 Update verfügbar für Mac Optimizer            ║
║                                                           ║
║  Neue Version herunterladen:                              ║
║  https://github.com/$REPO/tree/$BRANCH               ║
║                                                           ║
║  Schnell installieren:                                    ║
║  brew upgrade mac-optimizer                              ║
║                                                           ║
║  Changelog:                                               ║
║  https://github.com/$REPO/releases                  ║
╚═══════════════════════════════════════════════════════════╝

EOF
}

# Direkt-Aufruf
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ "${1:-}" == "--check" ]]; then
        if check_for_update; then
            show_update_message
            exit 0
        else
            echo "✓ Du hast die neueste Version"
            exit 1
        fi
    else
        echo "Usage: update-check.sh --check"
    fi
fi
