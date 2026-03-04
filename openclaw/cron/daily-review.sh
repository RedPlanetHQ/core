#!/bin/bash
# Daily Review - Runs daily at 22:00
# Agent: Monica (CEO/Orchestrator)
# Reviews the day, tracks revenue, plans next day

set -euo pipefail

WORKSPACE="/opt/money-machine"
MEMORY_DIR="$WORKSPACE/openclaw/memory"
LOG_FILE="$WORKSPACE/openclaw/memory/review.log"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
MODEL="${AI_MODEL:-glm4:9b-chat}"
TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ADMIN_ID="${TELEGRAM_ADMIN_ID:-8531161985}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [daily-review] $1" | tee -a "$LOG_FILE"
}

query_ai() {
  local prompt="$1"
  curl -s "$OLLAMA_URL/api/generate" \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"$prompt\", \"stream\": false}" \
    2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('response',''))" 2>/dev/null || echo ""
}

send_telegram() {
  local message="$1"
  if [ -n "$TELEGRAM_TOKEN" ]; then
    curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${ADMIN_ID}" \
      -d "text=${message}" \
      -d "parse_mode=Markdown" >/dev/null 2>&1
  fi
}

log "=== Daily Review gestartet ==="

# 1. System Health Summary
log "Phase 1: System-Health..."
OLLAMA_STATUS="offline"
curl -s "$OLLAMA_URL/api/tags" >/dev/null 2>&1 && OLLAMA_STATUS="online"

RAM_USAGE=$(free -h 2>/dev/null | awk '/^Mem:/{print $3"/"$2}' || echo "N/A")
DISK_USAGE=$(df -h / 2>/dev/null | awk 'NR==2{print $3"/"$2" ("$5")"}' || echo "N/A")

HEALTH_SUMMARY="Ollama: $OLLAMA_STATUS | RAM: $RAM_USAGE | Disk: $DISK_USAGE"
log "Health: $HEALTH_SUMMARY"

# 2. Revenue Tracking
log "Phase 2: Revenue-Check..."
REVENUE_FILE="$MEMORY_DIR/revenue.json"
TODAY=$(date '+%Y-%m-%d')

python3 -c "
import json, os
revenue_file = '$REVENUE_FILE'
data = {'daily': [], 'total': {'x_posts': 0, 'templates': 0, 'freelance': 0, 'affiliate': 0}}
if os.path.exists(revenue_file):
    with open(revenue_file) as f:
        data = json.load(f)

# Ensure today's entry exists
today_entry = next((d for d in data['daily'] if d['date'] == '$TODAY'), None)
if not today_entry:
    data['daily'].append({
        'date': '$TODAY',
        'x_posts': 0, 'templates': 0, 'freelance': 0, 'affiliate': 0,
        'notes': ''
    })
    # Keep last 90 days
    data['daily'] = data['daily'][-90:]
    with open(revenue_file, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
" 2>/dev/null && log "Revenue-Tracking aktualisiert" || log "WARN: Revenue-Datei konnte nicht aktualisiert werden"

# 3. AI Daily Summary
log "Phase 3: Tages-Zusammenfassung..."
DISCOVERIES_FILE="$MEMORY_DIR/discoveries.json"
DISCOVERY_COUNT=0
if [ -f "$DISCOVERIES_FILE" ]; then
  DISCOVERY_COUNT=$(python3 -c "
import json
with open('$DISCOVERIES_FILE') as f:
    data = json.load(f)
today_items = [d for d in data.get('discoveries',[]) if d.get('date','') == '$(date +%Y-%m-%d)']
print(len(today_items))
" 2>/dev/null || echo "0")
fi

SUMMARY=$(query_ai "Du bist Monica, CEO des Multi-Agent-Systems. Erstelle eine kurze Tages-Zusammenfassung (5 Saetze max). System-Status: $HEALTH_SUMMARY. Heute $DISCOVERY_COUNT neue Discoveries. Auf Deutsch.")

# 4. Send Telegram Report
log "Phase 4: Telegram-Report..."
REPORT="📊 *Daily Review - $(date '+%d.%m.%Y')*

🖥 *System:* $HEALTH_SUMMARY
🔍 *Discoveries heute:* $DISCOVERY_COUNT

📝 *Monica sagt:*
$SUMMARY"

send_telegram "$REPORT"
log "Telegram-Report gesendet"

log "=== Daily Review abgeschlossen ==="
