#!/bin/bash
# M0Claw Bot Daemon
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="/tmp/m0claw-bot.log"
PID_FILE="/tmp/m0claw-bot.pid"

# Kill existing
if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
fi

export TELEGRAM_BOT_TOKEN="8650716833:AAE5g3JjkJjnKjKMrWuAh7hYeeSl5lSLgYs"
export OLLAMA_BASE_URL="http://localhost:11434"
export AI_MODEL="llama3.2"
export TELEGRAM_TARGET_CHANNEL=""

cd "$SCRIPT_DIR"
npx tsx src/bot.ts >> "$LOG" 2>&1 &
echo $! > "$PID_FILE"
echo "M0Claw Bot started (PID: $(cat $PID_FILE))"
echo "Logs: $LOG"
