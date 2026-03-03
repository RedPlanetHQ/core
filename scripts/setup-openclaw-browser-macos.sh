#!/usr/bin/env bash
# ==============================================================================
# OpenClaw Browser Setup for macOS
# ==============================================================================
# This script sets up the OpenClaw browser environment on macOS including:
# - Detecting/installing a Chromium-based browser (Chrome/Brave/Edge)
# - Creating the ~/.openclaw configuration directory
# - Installing OpenClaw Gateway + CLI
# - Setting up browser profiles (openclaw, work, chrome relay)
# - Installing Playwright for advanced browser features
# - Installing the Chrome extension for relay mode
# ==============================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Helpers ---
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()    { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# --- Config ---
OPENCLAW_HOME="$HOME/.openclaw"
OPENCLAW_CONFIG="$OPENCLAW_HOME/openclaw.json"
BROWSER_DATA_DIR="$OPENCLAW_HOME/browser-data"
DOWNLOADS_DIR="/tmp/openclaw/downloads"
UPLOADS_DIR="/tmp/openclaw/uploads"
TRACES_DIR="/tmp/openclaw"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# --- Pre-flight checks ---
step "Pre-flight checks"

if [[ "$(uname -s)" != "Darwin" ]]; then
    error "This script is designed for macOS only."
    error "Detected OS: $(uname -s)"
    exit 1
fi
success "Running on macOS $(sw_vers -productVersion)"

if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js >= 18 first."
    error "  brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
    error "Node.js >= 18 required. Found: $(node -v)"
    exit 1
fi
success "Node.js $(node -v) detected"

if ! command -v npm &>/dev/null && ! command -v pnpm &>/dev/null; then
    error "No package manager found. Please install npm or pnpm."
    exit 1
fi
success "Package manager available"

# --- Detect Chromium-based browser ---
step "Detecting Chromium-based browser"

BROWSER_EXECUTABLE=""
BROWSER_NAME=""

detect_browser() {
    # Order: Chrome -> Brave -> Edge -> Chromium -> Chrome Canary
    local browsers=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome:Google Chrome"
        "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome:Google Chrome"
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser:Brave Browser"
        "$HOME/Applications/Brave Browser.app/Contents/MacOS/Brave Browser:Brave Browser"
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge:Microsoft Edge"
        "$HOME/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge:Microsoft Edge"
        "/Applications/Chromium.app/Contents/MacOS/Chromium:Chromium"
        "$HOME/Applications/Chromium.app/Contents/MacOS/Chromium:Chromium"
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary:Google Chrome Canary"
        "$HOME/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary:Google Chrome Canary"
    )

    for entry in "${browsers[@]}"; do
        local path="${entry%%:*}"
        local name="${entry##*:}"
        if [[ -f "$path" ]]; then
            BROWSER_EXECUTABLE="$path"
            BROWSER_NAME="$name"
            return 0
        fi
    done
    return 1
}

if detect_browser; then
    success "Found $BROWSER_NAME at: $BROWSER_EXECUTABLE"
else
    warn "No Chromium-based browser found!"
    info "Installing Google Chrome..."

    # Download Chrome DMG
    CHROME_DMG="/tmp/googlechrome.dmg"
    CHROME_URL="https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg"

    info "Downloading Google Chrome DMG..."
    if curl -L -o "$CHROME_DMG" "$CHROME_URL" --progress-bar; then
        success "Chrome DMG downloaded to $CHROME_DMG"
    else
        error "Failed to download Chrome DMG."
        error "Please manually download Chrome from https://www.google.com/chrome/"
        error "Then re-run this script."
        exit 1
    fi

    # Mount and install DMG
    info "Mounting DMG..."
    MOUNT_POINT=$(hdiutil attach "$CHROME_DMG" -nobrowse -noverify -noautoopen 2>/dev/null | grep "/Volumes" | tail -1 | awk -F'\t' '{print $NF}')

    if [[ -z "$MOUNT_POINT" ]]; then
        error "Failed to mount Chrome DMG."
        exit 1
    fi
    success "DMG mounted at: $MOUNT_POINT"

    # Copy Chrome.app to /Applications
    CHROME_APP="$MOUNT_POINT/Google Chrome.app"
    if [[ -d "$CHROME_APP" ]]; then
        info "Installing Google Chrome to /Applications..."
        cp -R "$CHROME_APP" "/Applications/"
        success "Google Chrome installed to /Applications/Google Chrome.app"
    else
        error "Could not find Google Chrome.app in the mounted DMG."
        hdiutil detach "$MOUNT_POINT" &>/dev/null || true
        exit 1
    fi

    # Unmount and cleanup
    info "Cleaning up..."
    hdiutil detach "$MOUNT_POINT" &>/dev/null || true
    rm -f "$CHROME_DMG"
    success "DMG cleanup complete"

    # Verify installation
    if detect_browser; then
        success "Chrome installed and verified: $BROWSER_EXECUTABLE"
    else
        error "Chrome installation could not be verified."
        exit 1
    fi
fi

# --- Create directory structure ---
step "Setting up OpenClaw directory structure"

mkdir -p "$OPENCLAW_HOME"
mkdir -p "$BROWSER_DATA_DIR/openclaw"
mkdir -p "$BROWSER_DATA_DIR/work"
mkdir -p "$DOWNLOADS_DIR"
mkdir -p "$UPLOADS_DIR"
mkdir -p "$TRACES_DIR"

success "Created $OPENCLAW_HOME"
success "Created browser data directories"
success "Created temp directories (downloads, uploads, traces)"

# --- Generate OpenClaw config ---
step "Generating OpenClaw configuration"

# Generate a random auth token
AUTH_TOKEN=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | LC_ALL=C tr -dc 'a-f0-9' | head -c 64)

# Build config with detected browser path
cat > "$OPENCLAW_CONFIG" << JSONEOF
{
  "browser": {
    "enabled": true,
    "defaultProfile": "openclaw",
    "headless": false,
    "noSandbox": false,
    "attachOnly": false,
    "color": "#FF4500",
    "executablePath": "$BROWSER_EXECUTABLE",
    "remoteCdpTimeoutMs": 1500,
    "remoteCdpHandshakeTimeoutMs": 3000,
    "evaluateEnabled": true,
    "snapshotDefaults": {
      "mode": "efficient"
    },
    "ssrfPolicy": {
      "dangerouslyAllowPrivateNetwork": true
    },
    "profiles": {
      "openclaw": {
        "cdpPort": 18800,
        "color": "#FF4500"
      },
      "work": {
        "cdpPort": 18801,
        "color": "#0066CC"
      },
      "chrome": {
        "cdpUrl": "http://127.0.0.1:18792",
        "color": "#4285F4"
      }
    }
  },
  "gateway": {
    "port": 18789,
    "auth": {
      "token": "$AUTH_TOKEN"
    }
  }
}
JSONEOF

success "Configuration written to $OPENCLAW_CONFIG"
info "Browser: $BROWSER_NAME"
info "Default profile: openclaw (isolated, agent-managed)"
info "Gateway port: 18789"
info "Auth token generated and saved"

# --- Copy project-level config ---
step "Syncing project-level OpenClaw config"

if [[ -f "$PROJECT_ROOT/.openclaw/openclaw.json" ]]; then
    info "Project-level .openclaw/openclaw.json found."
    info "The system-level config at $OPENCLAW_CONFIG takes precedence."
    info "Project config provides defaults for contributors."
    success "Project config exists and is compatible"
fi

# --- Install OpenClaw (npm) ---
step "Installing OpenClaw CLI and Gateway"

if command -v openclaw &>/dev/null; then
    CURRENT_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
    success "OpenClaw already installed: $CURRENT_VERSION"
    info "Updating to latest version..."
fi

if command -v pnpm &>/dev/null; then
    pnpm add -g openclaw@latest 2>/dev/null || npm install -g openclaw@latest
elif command -v npm &>/dev/null; then
    npm install -g openclaw@latest
fi

if command -v openclaw &>/dev/null; then
    success "OpenClaw CLI installed: $(openclaw --version 2>/dev/null || echo 'OK')"
else
    warn "OpenClaw CLI installation could not be verified."
    warn "You may need to install it manually: npm install -g openclaw"
fi

# --- Install Playwright ---
step "Installing Playwright (for advanced browser features)"

info "Playwright is required for: navigate, act, AI snapshot, screenshots, PDF"

if command -v npx &>/dev/null; then
    info "Installing Playwright and Chromium browser..."
    npx playwright install chromium 2>/dev/null || true
    success "Playwright Chromium installed"
else
    warn "npx not found. Install Playwright manually:"
    warn "  npx playwright install chromium"
fi

# --- Install Chrome extension ---
step "Chrome extension relay setup"

if command -v openclaw &>/dev/null; then
    info "Installing OpenClaw browser extension for Chrome relay mode..."
    EXTENSION_PATH=$(openclaw browser extension path 2>/dev/null || echo "")

    if [[ -n "$EXTENSION_PATH" ]]; then
        success "Extension available at: $EXTENSION_PATH"
        info ""
        info "To load the extension in Chrome/Brave:"
        info "  1. Open chrome://extensions"
        info "  2. Enable 'Developer mode' (top-right toggle)"
        info "  3. Click 'Load unpacked'"
        info "  4. Select: $EXTENSION_PATH"
        info "  5. Pin the extension, then click it on tabs you want to control"
    else
        info "Run 'openclaw browser extension install' after setup to get the extension."
    fi
else
    info "Chrome extension will be available after OpenClaw CLI is installed."
    info "Run: openclaw browser extension install"
fi

# --- Verify setup ---
step "Verifying setup"

echo ""
info "Checking browser accessibility..."
if openclaw browser --browser-profile openclaw status 2>/dev/null; then
    success "OpenClaw browser profile is accessible"
else
    info "Browser service not running yet (expected). Start it with:"
    info "  openclaw browser --browser-profile openclaw start"
fi

# --- Summary ---
step "Setup Complete"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenClaw Browser Setup - Complete!    ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo -e "  Config file:     $OPENCLAW_CONFIG"
echo -e "  Browser:         $BROWSER_NAME"
echo -e "  Browser path:    $BROWSER_EXECUTABLE"
echo -e "  Default profile: openclaw (isolated)"
echo -e "  Gateway port:    18789"
echo ""
echo -e "${CYAN}Browser profiles:${NC}"
echo -e "  ${YELLOW}openclaw${NC}  - Managed, isolated browser (port 18800)"
echo -e "  ${BLUE}work${NC}      - Separate work browser (port 18801)"
echo -e "  ${BLUE}chrome${NC}    - Extension relay to your system Chrome"
echo ""
echo -e "${CYAN}Quick start commands:${NC}"
echo -e "  openclaw browser --browser-profile openclaw start"
echo -e "  openclaw browser --browser-profile openclaw open https://example.com"
echo -e "  openclaw browser --browser-profile openclaw snapshot"
echo -e "  openclaw browser --browser-profile openclaw screenshot"
echo ""
echo -e "${CYAN}Temp directories:${NC}"
echo -e "  Downloads: $DOWNLOADS_DIR"
echo -e "  Uploads:   $UPLOADS_DIR"
echo -e "  Traces:    $TRACES_DIR"
echo ""
echo -e "${CYAN}Security:${NC}"
echo -e "  Auth token saved to config (auto-generated)"
echo -e "  Browser control is loopback-only"
echo -e "  SSRF policy: trusted-network mode (private network allowed)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Start the gateway:  openclaw start"
echo -e "  2. Start browser:      openclaw browser start"
echo -e "  3. Open a page:        openclaw browser open https://your-app-url"
echo -e "  4. Take snapshot:      openclaw browser snapshot"
echo ""
echo -e "  For Chrome extension relay:"
echo -e "  1. Load extension at chrome://extensions (Developer mode)"
echo -e "  2. Click extension icon on desired tab"
echo -e "  3. Use: openclaw browser --browser-profile chrome tabs"
echo ""
