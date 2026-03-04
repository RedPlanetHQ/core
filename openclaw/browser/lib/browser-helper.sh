#!/usr/bin/env bash
# ================================================================
# OpenClaw Browser Helper — Shared functions for browser automation
# ================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${GREEN}[BROWSER]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()    { echo -e "${CYAN}[STEP]${NC} $*"; }

# --- Config ---
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
SCREENSHOTS_DIR="/tmp/openclaw/screenshots"
DOWNLOADS_DIR="/tmp/openclaw/downloads"
UPLOADS_DIR="/tmp/openclaw/uploads"
MEMORY_DIR="$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")/memory"

mkdir -p "$SCREENSHOTS_DIR" "$DOWNLOADS_DIR" "$UPLOADS_DIR" "$MEMORY_DIR"

# --- Browser Profile Selection ---
# Usage: select_profile "openclaw" | "work" | "chrome"
select_profile() {
    local profile="${1:-openclaw}"
    export BROWSER_PROFILE="$profile"
    case "$profile" in
        openclaw) export CDP_PORT=18800 ;;
        work)     export CDP_PORT=18801 ;;
        chrome)   export CDP_PORT=18792 ;;
        *)        error "Unknown profile: $profile"; exit 1 ;;
    esac
    log "Browser profile: $profile (CDP port: $CDP_PORT)"
}

# --- Core Browser Commands ---
# Navigate to URL
browser_open() {
    local url="$1"
    local profile="${2:-openclaw}"
    log "Opening: $url (profile: $profile)"
    openclaw browser --browser-profile "$profile" open "$url" 2>/dev/null || {
        error "Failed to open $url"
        return 1
    }
}

# Take screenshot and save
browser_screenshot() {
    local name="${1:-screenshot}"
    local profile="${2:-openclaw}"
    local file="$SCREENSHOTS_DIR/${name}_$(date +%Y%m%d_%H%M%S).png"
    openclaw browser --browser-profile "$profile" screenshot --output "$file" 2>/dev/null || {
        warn "Screenshot failed, trying alternate method..."
        openclaw browser --browser-profile "$profile" screenshot > "$file" 2>/dev/null || return 1
    }
    log "Screenshot saved: $file"
    echo "$file"
}

# Get page snapshot (DOM text)
browser_snapshot() {
    local profile="${1:-openclaw}"
    openclaw browser --browser-profile "$profile" snapshot 2>/dev/null
}

# Click element by text or selector
browser_click() {
    local target="$1"
    local profile="${2:-openclaw}"
    log "Clicking: $target"
    openclaw browser --browser-profile "$profile" click "$target" 2>/dev/null || {
        warn "Click failed on: $target"
        return 1
    }
}

# Type text into focused element
browser_type() {
    local text="$1"
    local profile="${2:-openclaw}"
    openclaw browser --browser-profile "$profile" type "$text" 2>/dev/null || {
        warn "Type failed"
        return 1
    }
}

# Fill a specific field
browser_fill() {
    local selector="$1"
    local value="$2"
    local profile="${3:-openclaw}"
    openclaw browser --browser-profile "$profile" fill "$selector" "$value" 2>/dev/null || {
        warn "Fill failed on: $selector"
        return 1
    }
}

# Upload file
browser_upload() {
    local file_path="$1"
    local profile="${2:-openclaw}"
    log "Uploading file: $file_path"
    openclaw browser --browser-profile "$profile" upload "$file_path" 2>/dev/null || {
        warn "Upload failed"
        return 1
    }
}

# Wait for element
browser_wait() {
    local selector="$1"
    local timeout="${2:-10}"
    local profile="${3:-openclaw}"
    openclaw browser --browser-profile "$profile" wait "$selector" --timeout "$timeout" 2>/dev/null || {
        warn "Wait timeout for: $selector"
        return 1
    }
}

# Execute JavaScript
browser_eval() {
    local script="$1"
    local profile="${2:-openclaw}"
    openclaw browser --browser-profile "$profile" evaluate "$script" 2>/dev/null
}

# Get current URL
browser_url() {
    local profile="${1:-openclaw}"
    openclaw browser --browser-profile "$profile" evaluate "window.location.href" 2>/dev/null
}

# Wait seconds
wait_seconds() {
    local seconds="${1:-2}"
    sleep "$seconds"
}

# --- Memory Functions ---
save_to_memory() {
    local key="$1"
    local value="$2"
    local file="$MEMORY_DIR/browser-state.json"

    if [[ ! -f "$file" ]]; then
        echo '{}' > "$file"
    fi

    # Use python for JSON manipulation (available on both Mac + Server)
    python3 -c "
import json, sys
with open('$file', 'r') as f:
    data = json.load(f)
data['$key'] = '$value'
data['last_updated'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
with open('$file', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || warn "Memory save failed for key: $key"
}

load_from_memory() {
    local key="$1"
    local file="$MEMORY_DIR/browser-state.json"
    if [[ -f "$file" ]]; then
        python3 -c "
import json
with open('$file', 'r') as f:
    data = json.load(f)
print(data.get('$key', ''))
" 2>/dev/null
    fi
}

# --- Telegram Notification ---
notify_telegram() {
    local message="$1"
    local topic="${2:-}"
    if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && [[ -n "${TELEGRAM_CHAT_ID:-}" ]]; then
        local payload="{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"$message\", \"parse_mode\": \"Markdown\"}"
        if [[ -n "$topic" ]]; then
            payload="{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"$message\", \"parse_mode\": \"Markdown\", \"message_thread_id\": $topic}"
        fi
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "$payload" > /dev/null 2>&1 || true
    fi
}

# --- Login Check ---
check_login() {
    local platform="$1"
    local check_url="$2"
    local success_indicator="$3"
    local profile="${4:-openclaw}"

    browser_open "$check_url" "$profile"
    wait_seconds 3
    local snapshot
    snapshot=$(browser_snapshot "$profile")

    if echo "$snapshot" | grep -qi "$success_indicator"; then
        log "$platform: Already logged in"
        return 0
    else
        warn "$platform: Not logged in — manual login required"
        return 1
    fi
}

log "Browser helper loaded"
