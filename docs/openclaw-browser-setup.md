# OpenClaw Browser Setup for CORE

OpenClaw provides an isolated, agent-controlled browser for automation and verification tasks within the CORE project.

## Prerequisites

- **macOS** (Intel or Apple Silicon)
- **Node.js** >= 18
- **pnpm** or **npm**
- A Chromium-based browser (Chrome, Brave, Edge) — the setup script can install Chrome automatically

## Quick Setup (macOS)

Run the automated setup script:

```bash
./scripts/setup-openclaw-browser-macos.sh
```

This script will:
1. Detect or install a Chromium-based browser (downloads Chrome DMG if none found)
2. Create the `~/.openclaw` directory structure
3. Generate `~/.openclaw/openclaw.json` with browser configuration
4. Install the OpenClaw CLI and Gateway globally
5. Install Playwright for advanced browser features
6. Set up the Chrome extension for relay mode

## Configuration

### System-level config: `~/.openclaw/openclaw.json`

This is the primary config used by OpenClaw on your machine. It includes:
- Browser executable path (auto-detected)
- Gateway port and auth token
- Browser profiles (openclaw, work, chrome)
- SSRF policy settings

### Project-level config: `.openclaw/openclaw.json`

This provides shared defaults for all project contributors. It does **not** include machine-specific paths or auth tokens.

## Browser Profiles

| Profile    | Type      | Port/URL                    | Purpose                              |
|-----------|-----------|----------------------------|--------------------------------------|
| `openclaw` | Managed   | CDP port 18800             | Isolated agent-only browser          |
| `work`     | Managed   | CDP port 18801             | Separate work automation browser     |
| `chrome`   | Extension | `http://127.0.0.1:18792`  | Relay to your existing Chrome tabs   |

### Using profiles

```bash
# Start the openclaw managed browser
openclaw browser --browser-profile openclaw start

# Open a URL
openclaw browser --browser-profile openclaw open https://localhost:3000

# Take a snapshot (AI-readable page tree)
openclaw browser --browser-profile openclaw snapshot

# Screenshot
openclaw browser --browser-profile openclaw screenshot

# Use Chrome relay instead
openclaw browser --browser-profile chrome tabs
```

## Common Workflows

### Start the Gateway and browser

```bash
openclaw start
openclaw browser start
```

### Inspect a running CORE webapp

```bash
# Open the webapp
openclaw browser open http://localhost:3000

# Get an interactive snapshot
openclaw browser snapshot --interactive

# Click on element ref 12
openclaw browser click 12

# Type in a field
openclaw browser type 23 "search query" --submit
```

### Debug browser issues

```bash
# Check errors
openclaw browser errors --clear

# Check network requests
openclaw browser requests --filter api --clear

# Record a trace
openclaw browser trace start
# ... reproduce the issue ...
openclaw browser trace stop
```

## Chrome Extension Relay

To control your existing Chrome tabs:

1. Install the extension: `openclaw browser extension install`
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the extension directory
5. Pin the extension and click it on the tab you want to control
6. Use `openclaw browser --browser-profile chrome <command>`

## Security Notes

- Browser control binds to **loopback only** (127.0.0.1)
- Auth token is auto-generated on first setup
- The `openclaw` profile is fully isolated from your personal browser
- SSRF policy defaults to trusted-network mode (private network allowed)
- Set `dangerouslyAllowPrivateNetwork: false` for strict public-only mode

## Troubleshooting

### "Browser disabled"
Enable browser in config: set `browser.enabled: true` in `~/.openclaw/openclaw.json`

### "Playwright is not available"
Install Playwright: `npx playwright install chromium`

### Browser doesn't start
Check the executable path in config matches your installed browser:
```bash
# Find your browser
ls /Applications/ | grep -i -E "chrome|brave|edge|chromium"
```

### Port conflicts
The default ports are 18789 (gateway), 18800-18801 (browser profiles). If these conflict with other services, update the ports in `~/.openclaw/openclaw.json`.
