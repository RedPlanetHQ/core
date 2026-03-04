#!/usr/bin/env bash
# ================================================================
# KELLY — X/Twitter Browser Automation
# ================================================================
# Vollautomatische X/Twitter Steuerung via OpenClaw Browser
#
# Befehle:
#   ./x-twitter.sh login              — X Login pruefen
#   ./x-twitter.sh tweet <text>       — Tweet posten
#   ./x-twitter.sh thread <file>      — Thread posten (JSON)
#   ./x-twitter.sh reply <url> <text> — Auf Tweet antworten
#   ./x-twitter.sh trending           — Trending Topics
#   ./x-twitter.sh analytics          — Analytics Dashboard
#   ./x-twitter.sh schedule <text> <datetime> — Tweet schedulen
#   ./x-twitter.sh dm <user> <text>   — DM senden
#   ./x-twitter.sh profile            — Profil-Status
#   ./x-twitter.sh engage <query>     — Engagement: Like + Reply auf relevante Tweets
# ================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/browser-helper.sh"

PROFILE="openclaw"
X_HOME="https://x.com"
X_COMPOSE="https://x.com/compose/post"
X_ANALYTICS="https://analytics.twitter.com"

# ================================================================
# LOGIN CHECK
# ================================================================
cmd_login() {
    step "X/Twitter Login pruefen..."
    browser_open "$X_HOME/home" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")

    if echo "$snapshot" | grep -qi "What is happening\|Was gibt's Neues\|Home\|Post\|For you\|Fuer dich"; then
        log "X/Twitter: Eingeloggt!"
        save_to_memory "x_logged_in" "true"
        save_to_memory "x_last_login" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

        # Username extrahieren
        local username
        username=$(browser_eval "
            const handle = document.querySelector('[data-testid=\"UserName\"] a, [href*=\"/\"][role=\"link\"]');
            handle ? handle.textContent : 'unknown';
        " "$PROFILE" 2>/dev/null || echo "unknown")
        save_to_memory "x_username" "$username"
        log "Username: $username"

        browser_screenshot "x-dashboard" "$PROFILE"
        return 0
    else
        warn "X/Twitter: NICHT eingeloggt!"
        warn "Bitte manuell einloggen:"
        warn "  1. openclaw browser --browser-profile $PROFILE open https://x.com/login"
        warn "  2. Login durchfuehren"
        warn "  3. Dann nochmal: ./x-twitter.sh login"
        save_to_memory "x_logged_in" "false"
        return 1
    fi
}

# ================================================================
# TWEET POSTEN
# ================================================================
cmd_tweet() {
    local text="${1:-}"
    if [[ -z "$text" ]]; then
        error "Usage: ./x-twitter.sh tweet <text>"
        exit 1
    fi

    # Character Limit Check
    local char_count=${#text}
    if [[ $char_count -gt 280 ]]; then
        warn "Tweet hat $char_count Zeichen (Max: 280)"
        warn "Text wird auf 280 Zeichen gekuerzt oder verwende 'thread' fuer laengere Inhalte"
        read -p "Trotzdem posten (X Premium)? [y/N]: " APPROVE
        if [[ ! "$APPROVE" =~ ^[yY]$ ]]; then
            exit 0
        fi
    fi

    # Preview
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║          TWEET PREVIEW                ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC} $text"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} Zeichen: $char_count/280"
    echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
    echo ""
    read -p "Tweet posten? [y/N]: " APPROVE
    if [[ ! "$APPROVE" =~ ^[yY]$ ]]; then
        warn "Tweet abgebrochen."
        exit 0
    fi

    step "Tweet posten..."
    browser_open "$X_HOME/home" "$PROFILE"
    wait_seconds 3

    # Compose-Feld finden und klicken
    browser_eval "
        const composeBox = document.querySelector('[data-testid=\"tweetTextarea_0\"], [role=\"textbox\"][data-testid]');
        if (composeBox) composeBox.focus();
    " "$PROFILE" || true
    wait_seconds 1

    # Alternativ: Compose-Button klicken
    browser_click "Post" "$PROFILE" || browser_click "Posten" "$PROFILE" || true
    wait_seconds 1

    # Text eingeben
    browser_type "$text" "$PROFILE"
    wait_seconds 1

    # Post-Button klicken
    browser_eval "
        const postBtn = document.querySelector('[data-testid=\"tweetButtonInline\"], [data-testid=\"tweetButton\"]');
        if (postBtn) postBtn.click();
    " "$PROFILE" || browser_click "Post" "$PROFILE" || true
    wait_seconds 3

    log "Tweet gepostet!"
    browser_screenshot "x-tweet-posted" "$PROFILE"

    save_to_memory "x_last_tweet" "$text"
    save_to_memory "x_last_tweet_time" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    notify_telegram "🐦 *Tweet gepostet!*
$text"
}

# ================================================================
# THREAD POSTEN
# ================================================================
cmd_thread() {
    local thread_file="${1:-}"
    if [[ -z "$thread_file" ]]; then
        error "Usage: ./x-twitter.sh thread <thread.json>"
        echo ""
        echo "  Format thread.json:"
        echo '  {"posts": ["Post 1 (Hook)", "Post 2", "Post 3 (CTA)"]}'
        exit 1
    fi

    if [[ ! -f "$thread_file" ]]; then
        error "Thread-Datei nicht gefunden: $thread_file"
        exit 1
    fi

    local post_count
    post_count=$(python3 -c "import json; d=json.load(open('$thread_file')); print(len(d.get('posts',[])))" 2>/dev/null || echo "0")
    local posts
    posts=$(python3 -c "
import json
d = json.load(open('$thread_file'))
for i, p in enumerate(d.get('posts', []), 1):
    print(f'{i}/{len(d[\"posts\"])} {p[:80]}...' if len(p) > 80 else f'{i}/{len(d[\"posts\"])} {p}')
" 2>/dev/null || echo "Error reading thread")

    # Preview
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       THREAD PREVIEW ($post_count Posts)       ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════╣${NC}"
    echo "$posts" | while read -r line; do
        echo -e "${CYAN}║${NC} $line"
    done
    echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
    echo ""
    read -p "Thread posten ($post_count Posts)? [y/N]: " APPROVE
    if [[ ! "$APPROVE" =~ ^[yY]$ ]]; then
        warn "Thread abgebrochen."
        exit 0
    fi

    step "Thread mit $post_count Posts starten..."
    browser_open "$X_HOME/home" "$PROFILE"
    wait_seconds 3

    # Erster Post
    local first_post
    first_post=$(python3 -c "import json; d=json.load(open('$thread_file')); print(d['posts'][0])" 2>/dev/null)

    # Compose-Feld fokussieren
    browser_eval "
        const composeBox = document.querySelector('[data-testid=\"tweetTextarea_0\"], [role=\"textbox\"]');
        if (composeBox) composeBox.focus();
    " "$PROFILE" || true
    wait_seconds 1

    browser_type "$first_post" "$PROFILE"
    wait_seconds 1

    # Weitere Posts als Replies
    for i in $(seq 2 "$post_count"); do
        step "Post $i/$post_count..."

        # "Add another post" / "+" Button klicken
        browser_eval "
            const addBtn = document.querySelector('[data-testid=\"addButton\"], [aria-label*=\"Add\"], [aria-label*=\"Hinzuf\"]');
            if (addBtn) addBtn.click();
        " "$PROFILE" || true
        wait_seconds 1

        local post_text
        post_text=$(python3 -c "import json; d=json.load(open('$thread_file')); print(d['posts'][$((i-1))])" 2>/dev/null)
        browser_type "$post_text" "$PROFILE"
        wait_seconds 1
    done

    # Post All
    browser_eval "
        const postBtn = document.querySelector('[data-testid=\"tweetButton\"], [data-testid=\"tweetButtonInline\"]');
        if (postBtn) postBtn.click();
    " "$PROFILE" || true
    wait_seconds 3

    log "Thread mit $post_count Posts veroeffentlicht!"
    browser_screenshot "x-thread-posted" "$PROFILE"

    save_to_memory "x_last_thread" "$thread_file"
    save_to_memory "x_last_thread_time" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    save_to_memory "x_last_thread_count" "$post_count"

    notify_telegram "🧵 *X Thread gepostet!*
$post_count Posts veroeffentlicht"
}

# ================================================================
# REPLY
# ================================================================
cmd_reply() {
    local tweet_url="${1:-}"
    local reply_text="${2:-}"

    if [[ -z "$tweet_url" ]] || [[ -z "$reply_text" ]]; then
        error "Usage: ./x-twitter.sh reply <tweet-url> <text>"
        exit 1
    fi

    step "Reply auf: $tweet_url"
    browser_open "$tweet_url" "$PROFILE"
    wait_seconds 3

    # Reply-Feld klicken
    browser_eval "
        const replyBox = document.querySelector('[data-testid=\"tweetTextarea_0\"], [role=\"textbox\"]');
        if (replyBox) replyBox.focus();
    " "$PROFILE" || true
    wait_seconds 1

    browser_type "$reply_text" "$PROFILE"
    wait_seconds 1

    browser_eval "
        const replyBtn = document.querySelector('[data-testid=\"tweetButton\"], [data-testid=\"tweetButtonInline\"]');
        if (replyBtn) replyBtn.click();
    " "$PROFILE" || true
    wait_seconds 2

    log "Reply gepostet!"
    browser_screenshot "x-reply" "$PROFILE"
    notify_telegram "💬 *X Reply gepostet*
Auf: $tweet_url
Text: $reply_text"
}

# ================================================================
# TRENDING TOPICS
# ================================================================
cmd_trending() {
    step "Trending Topics laden..."
    browser_open "$X_HOME/explore/tabs/trending" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")
    browser_screenshot "x-trending" "$PROFILE"

    log "=== TRENDING TOPICS ==="

    local trends
    trends=$(browser_eval "
        const items = document.querySelectorAll('[data-testid=\"trend\"], [class*=\"trend\"]');
        let result = [];
        items.forEach((t, i) => {
            if (i < 15) result.push((i+1) + '. ' + t.textContent.trim().replace(/\\n+/g, ' | ').substring(0, 100));
        });
        result.join('\\n');
    " "$PROFILE" 2>/dev/null || echo "Trends nicht extrahierbar — siehe Screenshot")

    echo "$trends"
    save_to_memory "x_trending_last_check" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    notify_telegram "📈 *X Trending Topics*
$trends"
}

# ================================================================
# ANALYTICS
# ================================================================
cmd_analytics() {
    step "X Analytics laden..."
    browser_open "$X_HOME/analytics" "$PROFILE"
    wait_seconds 4

    browser_screenshot "x-analytics" "$PROFILE"

    local metrics
    metrics=$(browser_eval "
        const cards = document.querySelectorAll('[class*=\"stat\"], [class*=\"metric\"], [class*=\"analytics\"]');
        let result = [];
        cards.forEach(c => result.push(c.textContent.trim().substring(0, 120)));
        result.slice(0, 10).join('\\n');
    " "$PROFILE" 2>/dev/null || echo "Analytics nicht extrahierbar — siehe Screenshot")

    log "=== X ANALYTICS ==="
    echo "$metrics"

    save_to_memory "x_analytics_last_check" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    notify_telegram "📊 *X Analytics*
$metrics"
}

# ================================================================
# ENGAGE — Like + Reply auf relevante Tweets
# ================================================================
cmd_engage() {
    local query="${1:-}"
    if [[ -z "$query" ]]; then
        error "Usage: ./x-twitter.sh engage <search-query>"
        exit 1
    fi

    step "Engagement-Session: '$query'"

    # Encoded URL
    local encoded_query
    encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))" 2>/dev/null || echo "$query")

    browser_open "$X_HOME/search?q=${encoded_query}&f=live" "$PROFILE"
    wait_seconds 4

    browser_screenshot "x-engage-search" "$PROFILE"

    log "=== RELEVANTE TWEETS ==="
    local tweets
    tweets=$(browser_eval "
        const articles = document.querySelectorAll('article[data-testid=\"tweet\"]');
        let result = [];
        articles.forEach((a, i) => {
            if (i < 10) {
                const text = a.querySelector('[data-testid=\"tweetText\"]');
                const user = a.querySelector('[data-testid=\"User-Name\"]');
                result.push((i+1) + '. @' + (user ? user.textContent.trim().split('\\n')[0] : '?') + ': ' + (text ? text.textContent.trim().substring(0, 100) : ''));
            }
        });
        result.join('\\n');
    " "$PROFILE" 2>/dev/null || echo "Tweets nicht extrahierbar")

    echo "$tweets"
    log "Engagement-Session gestartet — Tweets gefunden"
    log "Manuell liken/replyen oder mit ./x-twitter.sh reply <url> <text>"

    notify_telegram "🔍 *X Engagement Session*
Query: $query
$tweets"
}

# ================================================================
# DM SENDEN
# ================================================================
cmd_dm() {
    local user="${1:-}"
    local text="${2:-}"

    if [[ -z "$user" ]] || [[ -z "$text" ]]; then
        error "Usage: ./x-twitter.sh dm <username> <text>"
        exit 1
    fi

    step "DM an @$user..."
    browser_open "$X_HOME/messages" "$PROFILE"
    wait_seconds 3

    # New Message
    browser_click "New message" "$PROFILE" || browser_click "Neue Nachricht" "$PROFILE" || true
    wait_seconds 1

    # User suchen
    browser_type "$user" "$PROFILE"
    wait_seconds 2

    # Ersten Treffer klicken
    browser_eval "
        const results = document.querySelectorAll('[role=\"option\"], [data-testid=\"typeaheadResult\"]');
        if (results.length > 0) results[0].click();
    " "$PROFILE" || true
    wait_seconds 1

    browser_click "Next" "$PROFILE" || browser_click "Weiter" "$PROFILE" || true
    wait_seconds 1

    # Nachricht eingeben
    browser_eval "
        const msgBox = document.querySelector('[data-testid=\"dmComposerTextInput\"], [role=\"textbox\"]');
        if (msgBox) msgBox.focus();
    " "$PROFILE" || true
    wait_seconds 1
    browser_type "$text" "$PROFILE"
    wait_seconds 1

    # Senden
    browser_eval "
        const sendBtn = document.querySelector('[data-testid=\"dmComposerSendButton\"], [aria-label*=\"Send\"], [aria-label*=\"Senden\"]');
        if (sendBtn) sendBtn.click();
    " "$PROFILE" || true
    wait_seconds 2

    log "DM an @$user gesendet!"
    browser_screenshot "x-dm-sent" "$PROFILE"
}

# ================================================================
# PROFIL STATUS
# ================================================================
cmd_profile() {
    step "X Profil-Status..."

    local username
    username=$(load_from_memory "x_username")
    if [[ -n "$username" ]]; then
        browser_open "$X_HOME/$username" "$PROFILE"
    else
        browser_open "$X_HOME/home" "$PROFILE"
    fi
    wait_seconds 4

    browser_screenshot "x-profile" "$PROFILE"

    local profile_data
    profile_data=$(browser_eval "
        const bio = document.querySelector('[data-testid=\"UserDescription\"]');
        const stats = document.querySelectorAll('[href*=\"/followers\"], [href*=\"/following\"]');
        let result = 'Bio: ' + (bio ? bio.textContent : 'N/A') + '\\n';
        stats.forEach(s => result += s.textContent.trim() + '\\n');
        result;
    " "$PROFILE" 2>/dev/null || echo "Profil nicht lesbar")

    log "=== X PROFIL ==="
    echo "$profile_data"

    local logged_in
    logged_in=$(load_from_memory "x_logged_in")
    local last_tweet
    last_tweet=$(load_from_memory "x_last_tweet")

    log "Login: ${logged_in:-unknown}"
    log "Letzter Tweet: ${last_tweet:-keiner}"
}

# ================================================================
# MAIN ROUTER
# ================================================================
case "${1:-help}" in
    login)     cmd_login ;;
    tweet)     cmd_tweet "${2:-}" ;;
    thread)    cmd_thread "${2:-}" ;;
    reply)     cmd_reply "${2:-}" "${3:-}" ;;
    trending)  cmd_trending ;;
    analytics) cmd_analytics ;;
    engage)    cmd_engage "${2:-}" ;;
    dm)        cmd_dm "${2:-}" "${3:-}" ;;
    profile)   cmd_profile ;;
    schedule)
        warn "Schedule-Feature kommt in Phase 2"
        warn "Nutze vorerst: tweet + manuelles Timing"
        ;;
    help|*)
        echo ""
        echo "  KELLY — X/Twitter Browser Automation"
        echo ""
        echo "  Usage: ./x-twitter.sh <command> [args]"
        echo ""
        echo "  Commands:"
        echo "    login                     — Login-Status pruefen"
        echo "    tweet <text>              — Tweet posten"
        echo "    thread <thread.json>      — Thread posten"
        echo "    reply <url> <text>        — Auf Tweet antworten"
        echo "    trending                  — Trending Topics"
        echo "    analytics                 — Analytics Dashboard"
        echo "    engage <query>            — Engagement-Session"
        echo "    dm <user> <text>          — DM senden"
        echo "    profile                   — Profil-Status"
        echo ""
        echo "  Thread JSON Format:"
        echo '    {"posts": ["Hook post", "Point 1", "Point 2", "CTA"]}'
        echo ""
        ;;
esac
