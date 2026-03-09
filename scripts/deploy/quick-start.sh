#!/usr/bin/env bash
# Quick-Start: Deploy Mac Optimizer for selling
# Tätigkeiten: GitHub Release → Gumroad → Social Media → Profit

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}=== Mac Optimizer Deployment Quick-Start ===${NC}\n"

# 1. GitHub Release
echo -e "${YELLOW}[1/4]${NC} GitHub Release erstellen?"
echo "Command: gh release create v1.0.0 -t 'Mac Optimizer v1.0' -n 'First production release'"
echo ""

# 2. Gumroad Setup
echo -e "${YELLOW}[2/4]${NC} Gumroad Setup"
cat <<EOF
1. Gehe zu https://gumroad.com/products
2. Erstelle neues Produkt: "Mac Optimizer Premium"
3. Setze Preis: \$19 (einmalig)
4. Erstelle Lizenz-Key-Generierung (Webhook)
5. Kopiere API Key hierher:

   export GUMROAD_API_KEY="your-key-here"
   export GUMROAD_WEBHOOK_SECRET="your-secret-here"
EOF
echo ""

# 3. Soziale Medien
echo -e "${YELLOW}[3/4]${NC} Social Media Launch-Text (Twitter/X)"
cat <<'EOF'

🚀 Just shipped: Mac Optimizer

Your Mac is slowing down. We fixed it.
✓ Auto-cleanup (DNS, RAM, temp files)
✓ Runs every hour in background
✓ Installs in 1 command
✓ Free + $19 Premium tier

Get it: https://github.com/Maurice-AIEMPIRE/core/releases/v1.0.0

#macOS #performance #productivity

EOF

# 4. Verkauf
echo -e "${YELLOW}[4/4]${NC} Verkauf starten"
cat <<'EOF'

Deploy-Checklist:
  ☐ GitHub Release erstellt (gh release create ...)
  ☐ Gumroad Produkt online ($19)
  ☐ Twitter/X Post gesendet
  ☐ Product Hunt (optional) submitted
  ☐ Subreddits (/r/macOS, /r/productivity) notified
  ☐ Newsletter (wenn vorhanden) gesendet
  ☐ Freunde/Familie gefragt zu testen

Profitiere:
  - Gumroad: 80% Auszahlung pro Verkauf → $15.20 pro License
  - Marketing kostet: 0€ (organisch, GitHub, Social Media)
  - Breakeven: Nach ~7-10 Sales (wenn Target: 100 Sales/Monat)

EOF

echo -e "\n${BOLD}Next Steps:${NC}\n"
echo "1. GitHub Release:"
echo "   gh release create v1.0.0 --title 'Mac Optimizer v1.0' -F PRODUCT.md\n"
echo "2. Post auf X/Twitter:\n"
echo "3. Monitor Sales:\n"
echo "   https://gumroad.com/dashboard\n"

echo -e "${GREEN}✓ Alle Dateien gebuildet. Deployment bereit!${NC}\n"
