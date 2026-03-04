#!/usr/bin/env bash
# Galaxia Planet Spawner — Erstellt einen neuen Planeten im Universum
# Usage: ./spawn-planet.sh "Planet-Name" "Ziel-Beschreibung"

set -euo pipefail

GALAXIA_ROOT="${GALAXIA_ROOT:-/root/galaxia}"
PLANETS_DIR="$GALAXIA_ROOT/planets"
PLANET_NAME="${1:?Usage: spawn-planet.sh 'Name' 'Ziel'}"
PLANET_GOAL="${2:?Usage: spawn-planet.sh 'Name' 'Ziel'}"
PLANET_DIR="$PLANETS_DIR/$PLANET_NAME"
DATE=$(date +%Y-%m-%d)

if [ -d "$PLANET_DIR" ]; then
    echo "⚠️  Planet '$PLANET_NAME' existiert bereits: $PLANET_DIR"
    exit 1
fi

echo "🪐 Spawne Planet: $PLANET_NAME"
echo "   Ziel: $PLANET_GOAL"

# Verzeichnisse erstellen
mkdir -p "$PLANET_DIR"/{data,output,scripts,logs}

# README
cat > "$PLANET_DIR/README.md" << EOF
# 🪐 Planet: $PLANET_NAME
## Ziel: $PLANET_GOAL
## Erstellt: $DATE
## Status: ACTIVE

### Pipeline
- [ ] Research (Dwight)
- [ ] Build (Ryan)
- [ ] Launch (Kelly/Pam)
- [ ] Revenue (Chandler)
- [ ] Review (Monica)

### Revenue
| Datum | Betrag | Quelle |
|-------|--------|--------|
| — | — | — |

### Logs
Siehe logs/ Verzeichnis
EOF

# Pipeline Config
cat > "$PLANET_DIR/pipeline.json" << EOF
{
  "planet": "$PLANET_NAME",
  "goal": "$PLANET_GOAL",
  "created": "$DATE",
  "status": "active",
  "agents": {
    "research": "dwight",
    "build": "ryan",
    "promote": "kelly",
    "sell": "chandler",
    "review": "monica"
  },
  "revenue": {
    "total": 0,
    "target": 1000,
    "currency": "EUR"
  }
}
EOF

echo "✓ Planet '$PLANET_NAME' gespawnt!"
echo "  Verzeichnis: $PLANET_DIR"
echo "  Pipeline: $PLANET_DIR/pipeline.json"
echo ""
echo "🔍 Vector-Index erstellen:"
echo "  python3 $GALAXIA_ROOT/../galaxia-vector-core.py index $PLANET_DIR"
