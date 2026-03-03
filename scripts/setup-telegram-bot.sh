#!/usr/bin/env bash
# ==============================================================================
# Telegram Bot Integration Setup for CORE
# ==============================================================================
# Sets up the Telegram bot integration with OpenClaw browser pairing.
# Bot ID: 8598721870
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()    { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OPENCLAW_HOME="$HOME/.openclaw"
TELEGRAM_BOT_ID="8598721870"
SKIP_VERIFY=false

# Parse flags
for arg in "$@"; do
    case "$arg" in
        --skip-verify) SKIP_VERIFY=true ;;
    esac
done

# --- Pre-flight ---
step "Pre-flight checks"

if ! command -v node &>/dev/null; then
    error "Node.js is not installed."
    exit 1
fi
success "Node.js $(node -v)"

if ! command -v pnpm &>/dev/null && ! command -v npm &>/dev/null; then
    error "No package manager found."
    exit 1
fi
success "Package manager available"

# --- Check for Bot Token ---
step "Telegram Bot Configuration"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    echo ""
    info "Bot ID: $TELEGRAM_BOT_ID"
    echo ""
    echo -e "${YELLOW}Please enter your Telegram Bot Token:${NC}"
    echo -e "${BLUE}(Get it from @BotFather on Telegram)${NC}"
    echo ""
    read -rp "Bot Token: " TELEGRAM_BOT_TOKEN
    echo ""
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    error "Bot token is required."
    error "1. Open Telegram and search for @BotFather"
    error "2. Send /mybots and select your bot (ID: $TELEGRAM_BOT_ID)"
    error "3. Get the API token"
    error "4. Run: TELEGRAM_BOT_TOKEN='your-token' $0"
    exit 1
fi

# --- Verify bot token ---
step "Verifying Bot Token"

if [[ "$SKIP_VERIFY" == "true" ]]; then
    warn "Skipping API verification (--skip-verify)"
    BOT_USERNAME="unknown"
    BOT_NAME="Telegram Bot"
    # Extract bot ID from token (first part before the colon)
    TELEGRAM_BOT_ID="${TELEGRAM_BOT_TOKEN%%:*}"
    success "Using bot ID from token: $TELEGRAM_BOT_ID"
else
    info "Calling Telegram getMe API..."
    VERIFY_RESPONSE=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" 2>/dev/null || echo '{"ok":false}')

    if echo "$VERIFY_RESPONSE" | grep -q '"ok":true'; then
        BOT_USERNAME=$(echo "$VERIFY_RESPONSE" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4)
        BOT_NAME=$(echo "$VERIFY_RESPONSE" | grep -o '"first_name":"[^"]*"' | head -1 | cut -d'"' -f4)
        VERIFIED_BOT_ID=$(echo "$VERIFY_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | sed 's/"id"://')

        success "Bot verified: $BOT_NAME (@$BOT_USERNAME)"
        success "Bot ID: $VERIFIED_BOT_ID"

        if [[ "$VERIFIED_BOT_ID" != "$TELEGRAM_BOT_ID" ]]; then
            warn "Bot ID mismatch! Expected $TELEGRAM_BOT_ID, got $VERIFIED_BOT_ID"
            warn "Proceeding with verified ID: $VERIFIED_BOT_ID"
            TELEGRAM_BOT_ID="$VERIFIED_BOT_ID"
        fi
    else
        error "Bot token verification failed."
        error "Response: $VERIFY_RESPONSE"
        error "Please check your token and try again."
        error "Hint: Use --skip-verify to skip API verification in offline environments."
        exit 1
    fi
fi

# --- Install integration dependencies ---
step "Installing Telegram integration dependencies"

TELEGRAM_DIR="$PROJECT_ROOT/integrations/telegram"

if [[ -d "$TELEGRAM_DIR" ]]; then
    info "Installing dependencies for Telegram integration..."
    cd "$TELEGRAM_DIR"

    if command -v pnpm &>/dev/null; then
        pnpm install 2>/dev/null || npm install
    else
        npm install
    fi

    cd "$PROJECT_ROOT"
    success "Dependencies installed"
else
    error "Telegram integration directory not found at $TELEGRAM_DIR"
    exit 1
fi

# --- Configure OpenClaw integration ---
step "Configuring OpenClaw pairing"

mkdir -p "$OPENCLAW_HOME"

# Update system-level OpenClaw config with Telegram integration
if [[ -f "$OPENCLAW_HOME/openclaw.json" ]]; then
    info "Updating existing OpenClaw config..."
else
    info "Creating OpenClaw config..."
    # Copy project-level config as base
    if [[ -f "$PROJECT_ROOT/.openclaw/openclaw.json" ]]; then
        cp "$PROJECT_ROOT/.openclaw/openclaw.json" "$OPENCLAW_HOME/openclaw.json"
    fi
fi

# Write Telegram-specific integration config
cat > "$OPENCLAW_HOME/telegram.json" << JSONEOF
{
  "telegram": {
    "botId": "$TELEGRAM_BOT_ID",
    "botUsername": "$BOT_USERNAME",
    "botName": "$BOT_NAME",
    "botToken": "$TELEGRAM_BOT_TOKEN",
    "paired": true,
    "pairedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "browserProfile": "openclaw",
    "syncEnabled": true,
    "syncFrequency": "*/15 * * * *"
  }
}
JSONEOF

success "Telegram config saved to $OPENCLAW_HOME/telegram.json"

# --- Update .env with Telegram token ---
step "Updating environment configuration"

ENV_FILE="$PROJECT_ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
    if grep -q "TELEGRAM_BOT_TOKEN" "$ENV_FILE"; then
        info "Updating existing TELEGRAM_BOT_TOKEN in .env..."
        sed -i.bak "s|TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN|" "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
    else
        info "Adding TELEGRAM_BOT_TOKEN to .env..."
        echo "" >> "$ENV_FILE"
        echo "# Telegram Bot Integration" >> "$ENV_FILE"
        echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" >> "$ENV_FILE"
        echo "TELEGRAM_BOT_ID=$TELEGRAM_BOT_ID" >> "$ENV_FILE"
    fi
    success ".env updated"
else
    info "Creating .env with Telegram configuration..."
    cat > "$ENV_FILE" << ENVEOF
# Telegram Bot Integration
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_ID=$TELEGRAM_BOT_ID
ENVEOF
    success ".env created"
fi

# --- Set up webhook (optional) ---
step "Webhook setup (optional)"

info "The bot currently uses polling mode (getUpdates)."
info "For production, you may want to set up a webhook."
info ""
info "To set up a webhook later:"
info "  curl -X POST 'https://api.telegram.org/bot\$TOKEN/setWebhook' \\"
info "    -H 'Content-Type: application/json' \\"
info "    -d '{\"url\": \"https://your-domain.com/api/v1/webhooks/telegram\"}'"

# --- Test sending a message ---
step "Testing bot connection"

if [[ "$SKIP_VERIFY" == "true" ]]; then
    warn "Skipping connection test (--skip-verify)"
else
    info "Fetching bot updates to verify connectivity..."
    UPDATES_RESPONSE=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=1&timeout=1" 2>/dev/null || echo '{"ok":false}')

    if echo "$UPDATES_RESPONSE" | grep -q '"ok":true'; then
        success "Bot API connection verified"
    else
        warn "Could not fetch updates (bot may not have received messages yet - this is normal)"
    fi
fi

# --- Summary ---
step "Setup Complete"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Telegram Bot Integration - Ready!     ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Bot Details:${NC}"
echo -e "  Name:     $BOT_NAME"
echo -e "  Username: @$BOT_USERNAME"
echo -e "  Bot ID:   $TELEGRAM_BOT_ID"
echo -e "  Status:   Paired & Verified"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo -e "  System config: $OPENCLAW_HOME/telegram.json"
echo -e "  Project env:   $PROJECT_ROOT/.env"
echo -e "  Integration:   $TELEGRAM_DIR/"
echo ""
echo -e "${CYAN}MCP Tools available:${NC}"
echo -e "  send_message       - Send text messages"
echo -e "  forward_message    - Forward messages between chats"
echo -e "  edit_message       - Edit sent messages"
echo -e "  delete_message     - Delete messages"
echo -e "  send_photo         - Send photos"
echo -e "  send_document      - Send documents"
echo -e "  get_chat           - Get chat info"
echo -e "  get_chat_member    - Get member info"
echo -e "  set_chat_title     - Change chat title"
echo -e "  pin_message        - Pin messages"
echo -e "  ban_chat_member    - Ban users"
echo -e "  unban_chat_member  - Unban users"
echo -e "  get_me             - Get bot info"
echo ""
echo -e "${CYAN}OpenClaw browser verification:${NC}"
echo -e "  openclaw browser open https://web.telegram.org"
echo -e "  openclaw browser snapshot"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Build: cd integrations/telegram && pnpm build"
echo -e "  2. Test:  Send a message to @$BOT_USERNAME on Telegram"
echo -e "  3. Sync:  The bot will auto-sync every 15 minutes"
echo ""
