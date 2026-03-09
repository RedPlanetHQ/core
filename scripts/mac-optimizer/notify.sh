#!/usr/bin/env bash
# notify.sh – macOS-Benachrichtigungen

# Nur macOS
[[ "$(uname)" == "Darwin" ]] || exit 0

OPTIMIZER_DIR="${OPTIMIZER_DIR:-$HOME/.mac-optimizer}"

# Log-Datei für Notifications (verhindert Spam)
NOTIFY_LOG="$OPTIMIZER_DIR/.notify.log"
NOTIFY_DEBOUNCE=600  # 10 Minuten

function notify() {
    local title="$1" message="$2" level="${3:-info}"

    # Premium-Check (wenn LICENSE_TIER nicht gesetzt, laden)
    if [[ -z "${LICENSE_TIER:-}" ]]; then
        source "$OPTIMIZER_DIR/license.sh" >/dev/null 2>&1
        check_license >/dev/null 2>&1 || true
    fi

    # Notifications nur im Premium-Tier
    if [[ "${LICENSE_TIER:-free}" != "premium" ]]; then
        return 0
    fi

    # Config laden
    if [[ -f "$OPTIMIZER_DIR/config.sh" ]]; then
        source "$OPTIMIZER_DIR/config.sh"
        load_config
    fi

    # Notifications deaktiviert?
    if [[ "${NOTIFY_ENABLED:-true}" != "true" ]]; then
        return 0
    fi

    # Level-Filtering
    local show=0
    case "$NOTIFY_LEVEL" in
        info) show=1 ;;
        warn) [[ "$level" == "warn" || "$level" == "error" ]] && show=1 ;;
        error) [[ "$level" == "error" ]] && show=1 ;;
    esac

    [[ $show -eq 0 ]] && return 0

    # Debounce: Nicht zu oft die gleiche Nachricht zeigen
    local notify_key="$title|$message"
    local notify_hash
    notify_hash=$(echo -n "$notify_key" | md5 | cut -c1-8)
    local notify_time_file="$OPTIMIZER_DIR/.notify.$notify_hash"

    if [[ -f "$notify_time_file" ]]; then
        local last_notify
        last_notify=$(cat "$notify_time_file")
        local now
        now=$(date +%s)
        if (( now - last_notify < NOTIFY_DEBOUNCE )); then
            return 0
        fi
    fi

    # Notification senden
    osascript <<APPLESCRIPT 2>/dev/null || return 1
tell application "System Events"
    display notification "$message" with title "Mac Optimizer – $title" subtitle ""
end tell
APPLESCRIPT

    date +%s > "$notify_time_file"
}

# Sound + Notification (für wichtige Alerts)
function notify_alert() {
    local title="$1" message="$2"

    notify "$title" "$message" "error"

    # Kurzer Sound
    osascript -e 'beep' 2>/dev/null || true
}

# Direkt-Aufruf
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    notify "Test" "Dies ist eine Test-Benachrichtigung" "info"
fi
