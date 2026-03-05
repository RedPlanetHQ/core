#!/bin/bash
# =============================================================
# STEIPETE SKILLS INSTALLER
# Installiert ALLE @steipete ClawHub Skills + Top Community Skills
# Direkt auf dem Hetzner Server ausfuehren:
#   curl -sL URL | bash
# oder:
#   bash install-steipete-skills.sh
# =============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}=== STEIPETE SKILLS INSTALLER ===${NC}"
echo -e "${CYAN}Installiert alle 17 @steipete Skills + 5 Top Community Skills${NC}"
echo ""

# Pruefen ob OpenClaw Container laeuft
if ! docker inspect --format='{{.State.Running}}' openclaw 2>/dev/null | grep -q true; then
    echo -e "${RED}FEHLER: OpenClaw Container laeuft nicht!${NC}"
    echo "  Starte mit: cd /opt/ki-power && docker compose up -d"
    exit 1
fi

echo -e "${BOLD}=== @steipete Skills (clawhub.ai/u/steipete) ===${NC}"
echo ""

STEIPETE_SKILLS=(
    "clawdhub|ClawdHub CLI - Skills suchen, installieren, updaten"
    "github|GitHub - Issues, PRs, Repos, Actions"
    "gog|Google Workspace - Gmail, Calendar, Drive, Sheets, Docs"
    "bird|Bird - Bluesky/Twitter Social Media"
    "slack|Slack - Nachrichten, Channels, Reactions"
    "notion|Notion - Pages, Databases, Blocks"
    "1password|1Password CLI - Secrets lesen/injizieren"
    "trello|Trello - Boards, Listen, Karten"
    "brave-search|Brave Search - Web-Suche ohne Browser"
    "coding-agent|Coding Agent - Code schreiben + refactoren"
    "frontend-design|Frontend Design - Production Web-UI"
    "wacli|WhatsApp CLI - WhatsApp Integration"
    "qmd|Qmd - Lokale Suche (BM25 + Vektoren + Rerank)"
    "blogwatcher|Blogwatcher - RSS/Atom Feeds ueberwachen"
    "peekaboo|Peekaboo - macOS UI Capture + Automation"
    "tmux|Tmux - Terminal Sessions fernsteuern"
    "things-mac|Things Mac - Things 3 Aufgaben"
)

OK=0
FAIL=0
TOTAL=${#STEIPETE_SKILLS[@]}

for entry in "${STEIPETE_SKILLS[@]}"; do
    SLUG="${entry%%|*}"
    DESC="${entry##*|}"
    if docker exec openclaw npx clawhub@latest install "@steipete/${SLUG}" 2>/dev/null; then
        echo -e "${GREEN}  OK  ${SLUG} - ${DESC}${NC}"
        OK=$((OK + 1))
    else
        echo -e "${YELLOW}  SKIP ${SLUG} - ${DESC}${NC}"
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo -e "${BOLD}=== Gog Binary (fuer Google Workspace) ===${NC}"

GOG_URL=$(curl -fsSL https://api.github.com/repos/steipete/gogcli/releases/latest 2>/dev/null | jq -r '.assets[] | select(.name | contains("linux_amd64")) | .browser_download_url' 2>/dev/null || echo "")
if [ -n "$GOG_URL" ]; then
    cd /tmp
    curl -fsSL -o gogcli.tgz "$GOG_URL"
    tar -xzf gogcli.tgz
    install -m 0755 gog /usr/local/bin/gog 2>/dev/null
    docker cp /usr/local/bin/gog openclaw:/usr/local/bin/gog 2>/dev/null || true
    echo -e "${GREEN}  OK  gog Binary -> /usr/local/bin/gog${NC}"
    rm -f /tmp/gogcli.tgz /tmp/gog
else
    echo -e "${YELLOW}  SKIP gog Binary - manuell: github.com/steipete/gogcli${NC}"
fi

echo ""
echo -e "${BOLD}=== Top Community Skills ===${NC}"
echo ""

COMMUNITY_SKILLS=(
    "capability-evolver|Capability Evolver (35K DL)"
    "self-improving-agent|Self-Improving Agent (15K DL)"
    "byterover|ByteRover (16K DL)"
    "agent-browser|Agent Browser (11K DL)"
    "summarize|Summarize (10K DL)"
)

for entry in "${COMMUNITY_SKILLS[@]}"; do
    SLUG="${entry%%|*}"
    DESC="${entry##*|}"
    if docker exec openclaw npx clawhub@latest install "${SLUG}" 2>/dev/null; then
        echo -e "${GREEN}  OK  ${DESC}${NC}"
        OK=$((OK + 1))
    else
        echo -e "${YELLOW}  SKIP ${DESC}${NC}"
        FAIL=$((FAIL + 1))
    fi
done

TOTAL_ALL=$((TOTAL + ${#COMMUNITY_SKILLS[@]}))

echo ""
echo -e "${CYAN}${BOLD}=============================${NC}"
echo -e "${GREEN}  Installiert: ${OK}/${TOTAL_ALL} Skills${NC}"
if [ $FAIL -gt 0 ]; then
    echo -e "${YELLOW}  Uebersprungen: ${FAIL} (manuell nachinstallieren)${NC}"
fi
echo ""
echo -e "${BOLD}Installierte Skills pruefen:${NC}"
echo "  docker exec openclaw ls ~/.openclaw/skills/"
echo ""
echo -e "${BOLD}Weitere Skills suchen:${NC}"
echo "  docker exec openclaw npx clawhub@latest search \"keyword\""
echo ""
echo -e "${BOLD}Google Workspace einrichten:${NC}"
echo "  gog auth credentials /pfad/zu/client_secret.json"
echo "  gog auth add deine@gmail.com --services gmail,calendar,drive,sheets,docs"
echo ""
