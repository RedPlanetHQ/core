#!/bin/bash
# Auto-Deploy: Pulls latest changes and restarts services if updated
# Runs every 2 minutes via cron

set -e

REPO_DIR="${DEPLOY_REPO_DIR:-/opt/money-machine}"
LOG_FILE="/var/log/auto-deploy.log"
LOCK_FILE="/tmp/auto-deploy.lock"
BRANCH="${DEPLOY_BRANCH:-main}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

cd "$REPO_DIR" || { log "ERROR: Repo dir $REPO_DIR not found"; exit 1; }

# Fetch latest
git fetch origin "$BRANCH" 2>/dev/null || { log "ERROR: git fetch failed"; exit 1; }

# Check if there are new commits
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  # No changes - silent exit
  exit 0
fi

log "UPDATE DETECTED: $LOCAL -> $REMOTE"
log "Changes:"
git log --oneline "$LOCAL..$REMOTE" >> "$LOG_FILE" 2>&1

# Pull changes
git pull origin "$BRANCH" >> "$LOG_FILE" 2>&1

if [ $? -ne 0 ]; then
  log "ERROR: git pull failed"
  exit 1
fi

log "Pull successful"

# Check what changed to decide what to restart
CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")
log "Changed files: $CHANGED_FILES"

# Restart Telegram bot if bot files changed
if echo "$CHANGED_FILES" | grep -q "integrations/telegram"; then
  log "Restarting Telegram Bot..."
  cd "$REPO_DIR/integrations/telegram"
  if [ -f start.sh ]; then
    # Kill old bot process
    pkill -f "tsx src/bot.ts" 2>/dev/null || true
    sleep 1
    bash start.sh > /tmp/telegram-bot.log 2>&1 &
    log "Telegram Bot restarted (PID: $!)"
  fi
  cd "$REPO_DIR"
fi

# Restart dashboard if dashboard files changed
if echo "$CHANGED_FILES" | grep -q "dashboard/"; then
  log "Restarting Dashboard..."
  pkill -f "streamlit run dashboard" 2>/dev/null || true
  sleep 1
  cd "$REPO_DIR/dashboard"
  streamlit run dashboard.py --server.port 8503 --server.address 0.0.0.0 > /tmp/dashboard.log 2>&1 &
  log "Dashboard restarted (PID: $!)"
  cd "$REPO_DIR"
fi

# Install new deps if package files changed
if echo "$CHANGED_FILES" | grep -q "package.json\|pnpm-lock.yaml"; then
  log "Installing dependencies..."
  cd "$REPO_DIR"
  pnpm install >> "$LOG_FILE" 2>&1
  log "Dependencies installed"
fi

# Notify via Telegram if token is available
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ADMIN_ID" ]; then
  COMMIT_MSG=$(git log -1 --pretty=format:"%s")
  SHORT_HASH=$(git rev-parse --short HEAD)
  MSG="Auto-Deploy erfolgreich%0A%0ACommit: ${SHORT_HASH}%0A${COMMIT_MSG}"
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_ADMIN_ID}&text=${MSG}" > /dev/null 2>&1
fi

log "Deploy complete"
