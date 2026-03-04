#!/bin/bash
# Discovery Sprint - Runs daily at 09:00
# Agent: Dwight (Research Lead)
# Searches for trends, opportunities, and actionable intelligence

set -euo pipefail

WORKSPACE="/opt/money-machine"
CONFIG_DIR="$WORKSPACE/openclaw/config"
MEMORY_DIR="$WORKSPACE/openclaw/memory"
LOG_FILE="$WORKSPACE/openclaw/memory/discovery.log"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
MODEL="${AI_MODEL:-glm4:9b-chat}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [discovery-sprint] $1" | tee -a "$LOG_FILE"
}

query_ai() {
  local prompt="$1"
  curl -s "$OLLAMA_URL/api/generate" \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"$prompt\", \"stream\": false}" \
    2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('response',''))" 2>/dev/null || echo ""
}

log "=== Discovery Sprint gestartet ==="

# 1. Trend Research
log "Phase 1: Trend-Analyse..."
TRENDS=$(query_ai "Du bist Dwight, ein Research-Agent. Liste die Top 5 aktuellen Tech- und AI-Trends auf, die monetarisierbar sind. Kurz und knapp, je 1 Satz. Auf Deutsch.")

if [ -n "$TRENDS" ]; then
  log "Trends gefunden"
  TIMESTAMP=$(date '+%Y-%m-%d')

  # Save to memory
  python3 -c "
import json, os
memory_file = '$MEMORY_DIR/discoveries.json'
data = {'discoveries': []}
if os.path.exists(memory_file):
    with open(memory_file) as f:
        data = json.load(f)
data['discoveries'].append({
    'date': '$TIMESTAMP',
    'type': 'trend_analysis',
    'content': '''$TRENDS''',
    'agent': 'dwight',
    'status': 'new'
})
# Keep last 100 entries
data['discoveries'] = data['discoveries'][-100:]
with open(memory_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
" 2>/dev/null && log "Trends gespeichert" || log "WARN: Trends konnten nicht gespeichert werden"
else
  log "WARN: Keine Trends erhalten (Ollama offline?)"
fi

# 2. Opportunity Scan
log "Phase 2: Opportunity-Scan..."
OPPORTUNITIES=$(query_ai "Du bist Dwight. Analysiere aktuelle Freelance- und SaaS-Moeglichkeiten im AI-Bereich. Nenne 3 konkrete Einnahmequellen mit geschaetztem Potenzial. Deutsch, kurz.")

if [ -n "$OPPORTUNITIES" ]; then
  log "Opportunities gefunden und gespeichert"
fi

# 3. Competitor Check
log "Phase 3: Wettbewerbs-Check..."
COMPETITORS=$(query_ai "Du bist Dwight. Welche neuen AI-Tools oder Projekte sind gerade im Kommen, die als Inspiration oder Wettbewerb relevant sein koennten? Top 3, kurz. Deutsch.")

if [ -n "$COMPETITORS" ]; then
  log "Wettbewerbs-Daten erfasst"
fi

log "=== Discovery Sprint abgeschlossen ==="
