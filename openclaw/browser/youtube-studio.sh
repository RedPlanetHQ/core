#!/usr/bin/env bash
# ================================================================
# ROSS — YouTube Studio Browser Automation
# ================================================================
# Vollautomatische YouTube Studio Steuerung via OpenClaw Browser
#
# Befehle:
#   ./youtube-studio.sh login              — YouTube Studio Login pruefen
#   ./youtube-studio.sh upload <file> <meta.json>  — Video hochladen
#   ./youtube-studio.sh thumbnail <video-url> <img> — Thumbnail aendern
#   ./youtube-studio.sh analytics          — Analytics abrufen
#   ./youtube-studio.sh comments           — Kommentare abrufen
#   ./youtube-studio.sh community <text>   — Community Post erstellen
#   ./youtube-studio.sh shorts <file> <meta.json>  — Short hochladen
#   ./youtube-studio.sh status             — Kanal-Status
# ================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/browser-helper.sh"

PROFILE="openclaw"
YOUTUBE_STUDIO="https://studio.youtube.com"
YOUTUBE_UPLOAD="https://studio.youtube.com/channel/UC/videos/upload"

# ================================================================
# LOGIN CHECK
# ================================================================
cmd_login() {
    step "YouTube Studio Login pruefen..."
    browser_open "$YOUTUBE_STUDIO" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")

    if echo "$snapshot" | grep -qi "channel dashboard\|Kanal-Dashboard\|upload\|hochladen\|Your channel"; then
        log "YouTube Studio: Eingeloggt!"
        save_to_memory "youtube_logged_in" "true"
        save_to_memory "youtube_last_login" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

        # Kanalnamen extrahieren
        local channel_name
        channel_name=$(echo "$snapshot" | grep -oP '(?<=channel/)[^/]+' | head -1 || echo "unknown")
        save_to_memory "youtube_channel" "$channel_name"
        log "Kanal: $channel_name"

        browser_screenshot "youtube-studio-dashboard" "$PROFILE"
        return 0
    else
        warn "YouTube Studio: NICHT eingeloggt!"
        warn "Bitte manuell einloggen:"
        warn "  1. openclaw browser --browser-profile $PROFILE open https://accounts.google.com"
        warn "  2. Google Account einloggen"
        warn "  3. Dann nochmal: ./youtube-studio.sh login"
        save_to_memory "youtube_logged_in" "false"
        return 1
    fi
}

# ================================================================
# VIDEO UPLOAD
# ================================================================
cmd_upload() {
    local video_file="${1:-}"
    local meta_file="${2:-}"

    if [[ -z "$video_file" ]]; then
        error "Usage: ./youtube-studio.sh upload <video-file> <metadata.json>"
        exit 1
    fi

    if [[ ! -f "$video_file" ]]; then
        error "Video nicht gefunden: $video_file"
        exit 1
    fi

    # Metadata laden
    local title="" description="" tags="" visibility="public" thumbnail=""
    if [[ -n "$meta_file" ]] && [[ -f "$meta_file" ]]; then
        title=$(python3 -c "import json; d=json.load(open('$meta_file')); print(d.get('title',''))" 2>/dev/null || echo "")
        description=$(python3 -c "import json; d=json.load(open('$meta_file')); print(d.get('description',''))" 2>/dev/null || echo "")
        tags=$(python3 -c "import json; d=json.load(open('$meta_file')); print(','.join(d.get('tags',[])))" 2>/dev/null || echo "")
        visibility=$(python3 -c "import json; d=json.load(open('$meta_file')); print(d.get('visibility','public'))" 2>/dev/null || echo "public")
        thumbnail=$(python3 -c "import json; d=json.load(open('$meta_file')); print(d.get('thumbnail',''))" 2>/dev/null || echo "")
        log "Metadata geladen aus: $meta_file"
    fi

    step "=== YOUTUBE UPLOAD STARTEN ==="
    log "Video: $video_file"
    log "Titel: $title"
    log "Visibility: $visibility"

    # --- HUMAN IN THE LOOP: Preview ---
    echo ""
    echo -e "${YELLOW}╔═══════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║     UPLOAD PREVIEW — APPROVAL         ║${NC}"
    echo -e "${YELLOW}╠═══════════════════════════════════════╣${NC}"
    echo -e "${YELLOW}║${NC} Titel:       $title"
    echo -e "${YELLOW}║${NC} Video:       $(basename "$video_file")"
    echo -e "${YELLOW}║${NC} Visibility:  $visibility"
    echo -e "${YELLOW}║${NC} Tags:        $tags"
    echo -e "${YELLOW}║${NC} Thumbnail:   ${thumbnail:-none}"
    echo -e "${YELLOW}╚═══════════════════════════════════════╝${NC}"
    echo ""
    read -p "Upload starten? [y/N]: " APPROVE
    if [[ ! "$APPROVE" =~ ^[yY]$ ]]; then
        warn "Upload abgebrochen."
        exit 0
    fi

    # Step 1: YouTube Studio oeffnen
    step "1/7 — YouTube Studio oeffnen"
    browser_open "$YOUTUBE_STUDIO" "$PROFILE"
    wait_seconds 3

    # Step 2: Upload-Button klicken
    step "2/7 — Upload starten"
    browser_click "CREATE" "$PROFILE" || browser_click "Erstellen" "$PROFILE" || true
    wait_seconds 1
    browser_click "Upload videos" "$PROFILE" || browser_click "Videos hochladen" "$PROFILE" || true
    wait_seconds 2

    # Step 3: Video-Datei hochladen
    step "3/7 — Video hochladen: $(basename "$video_file")"
    browser_upload "$video_file" "$PROFILE"
    log "Upload gestartet — warte auf Verarbeitung..."

    # Warte auf Upload-Fortschritt
    local upload_done=false
    for i in $(seq 1 60); do
        wait_seconds 5
        local snap
        snap=$(browser_snapshot "$PROFILE" 2>/dev/null || echo "")
        if echo "$snap" | grep -qi "processing\|verarbeitung\|checks\|ueberpr"; then
            log "Upload laeuft... ($((i * 5))s)"
        fi
        if echo "$snap" | grep -qi "details\|titel\|title"; then
            upload_done=true
            log "Upload abgeschlossen — Details-Seite erreicht"
            break
        fi
    done

    if [[ "$upload_done" != "true" ]]; then
        warn "Upload Timeout — bitte manuell pruefen"
        browser_screenshot "youtube-upload-timeout" "$PROFILE"
    fi

    # Step 4: Titel eintragen
    step "4/7 — Titel eintragen"
    if [[ -n "$title" ]]; then
        # Titel-Feld finden und befuellen
        browser_eval "
            const titleInput = document.querySelector('#textbox[aria-label*=\"title\"], #textbox[aria-label*=\"Titel\"]');
            if (titleInput) {
                titleInput.textContent = '';
                titleInput.focus();
            }
        " "$PROFILE" || true
        wait_seconds 1
        browser_type "$title" "$PROFILE" || true
        log "Titel eingetragen: $title"
    fi

    # Step 5: Beschreibung eintragen
    step "5/7 — Beschreibung eintragen"
    if [[ -n "$description" ]]; then
        browser_eval "
            const descInputs = document.querySelectorAll('#textbox');
            if (descInputs.length > 1) {
                descInputs[1].textContent = '';
                descInputs[1].focus();
            }
        " "$PROFILE" || true
        wait_seconds 1
        browser_type "$description" "$PROFILE" || true
        log "Beschreibung eingetragen"
    fi

    # Step 6: Thumbnail hochladen
    step "6/7 — Thumbnail"
    if [[ -n "$thumbnail" ]] && [[ -f "$thumbnail" ]]; then
        browser_click "Upload thumbnail" "$PROFILE" || browser_click "Thumbnail hochladen" "$PROFILE" || true
        wait_seconds 1
        browser_upload "$thumbnail" "$PROFILE" || true
        log "Thumbnail hochgeladen: $thumbnail"
    else
        log "Kein Thumbnail angegeben — Standard-Thumbnail wird verwendet"
    fi

    # Step 7: Visibility setzen + Publishen
    step "7/7 — Visibility: $visibility"

    # Zur Visibility-Seite navigieren (NEXT klicken bis Visibility)
    for i in 1 2 3; do
        browser_click "NEXT" "$PROFILE" || browser_click "WEITER" "$PROFILE" || true
        wait_seconds 2
    done

    case "$visibility" in
        public)
            browser_click "Public" "$PROFILE" || browser_click "Oeffentlich" "$PROFILE" || true
            ;;
        unlisted)
            browser_click "Unlisted" "$PROFILE" || browser_click "Nicht gelistet" "$PROFILE" || true
            ;;
        private)
            browser_click "Private" "$PROFILE" || browser_click "Privat" "$PROFILE" || true
            ;;
    esac
    wait_seconds 1

    # PUBLISH
    browser_click "PUBLISH" "$PROFILE" || browser_click "VEROEFFENTLICHEN" "$PROFILE" || browser_click "SAVE" "$PROFILE" || true
    wait_seconds 3

    log "=== VIDEO VEROEFFENTLICHT ==="
    browser_screenshot "youtube-upload-complete" "$PROFILE"

    # Video-URL extrahieren
    local video_url
    video_url=$(browser_eval "
        const link = document.querySelector('a[href*=\"youtu.be\"], a[href*=\"youtube.com/video\"]');
        link ? link.href : 'URL nicht gefunden';
    " "$PROFILE" 2>/dev/null || echo "URL wird spaeter verfuegbar")

    log "Video URL: $video_url"

    # Memory speichern
    save_to_memory "youtube_last_upload" "$title"
    save_to_memory "youtube_last_upload_time" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    save_to_memory "youtube_last_url" "$video_url"

    # Telegram Notification
    notify_telegram "🎬 *YouTube Upload Complete!*
📹 $title
🔗 $video_url
📊 Visibility: $visibility"

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     UPLOAD ERFOLGREICH!                ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} Titel: $title"
    echo -e "${GREEN}║${NC} URL:   $video_url"
    echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
}

# ================================================================
# ANALYTICS
# ================================================================
cmd_analytics() {
    step "YouTube Analytics abrufen..."
    browser_open "${YOUTUBE_STUDIO}/channel/UC/analytics" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")
    browser_screenshot "youtube-analytics" "$PROFILE"

    # Key Metrics extrahieren
    log "=== YOUTUBE ANALYTICS ==="

    # Views, Watch Time, Subscribers via JS extrahieren
    local metrics
    metrics=$(browser_eval "
        const cards = document.querySelectorAll('.metric-card, .data-card, [class*=\"metric\"]');
        let result = [];
        cards.forEach(c => result.push(c.textContent.trim().substring(0, 100)));
        result.join('\\n');
    " "$PROFILE" 2>/dev/null || echo "Metrics nicht extrahierbar")

    echo "$metrics"

    save_to_memory "youtube_analytics_last_check" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    notify_telegram "📊 *YouTube Analytics Check*
$(echo "$metrics" | head -5)"

    log "Analytics Screenshot gespeichert"
}

# ================================================================
# COMMENTS
# ================================================================
cmd_comments() {
    step "YouTube Kommentare abrufen..."
    browser_open "${YOUTUBE_STUDIO}/channel/UC/comments" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")
    browser_screenshot "youtube-comments" "$PROFILE"

    log "=== NEUESTE KOMMENTARE ==="
    # Kommentare extrahieren
    local comments
    comments=$(browser_eval "
        const items = document.querySelectorAll('[id*=\"comment\"], .comment-text, [class*=\"comment-content\"]');
        let result = [];
        items.forEach((c, i) => {
            if (i < 10) result.push((i+1) + '. ' + c.textContent.trim().substring(0, 200));
        });
        result.join('\\n');
    " "$PROFILE" 2>/dev/null || echo "Keine Kommentare gefunden")

    echo "$comments"
    notify_telegram "💬 *YouTube Kommentare*
$comments"
}

# ================================================================
# COMMUNITY POST
# ================================================================
cmd_community() {
    local text="${1:-}"
    if [[ -z "$text" ]]; then
        error "Usage: ./youtube-studio.sh community <text>"
        exit 1
    fi

    step "Community Post erstellen..."
    browser_open "${YOUTUBE_STUDIO}/channel/UC/community" "$PROFILE"
    wait_seconds 3

    # Create Post klicken
    browser_click "Create" "$PROFILE" || browser_click "Erstellen" "$PROFILE" || true
    wait_seconds 2

    # Text eingeben
    browser_type "$text" "$PROFILE" || true
    wait_seconds 1

    # Preview
    echo ""
    echo -e "${YELLOW}Community Post Preview:${NC}"
    echo "$text"
    echo ""
    read -p "Posten? [y/N]: " APPROVE
    if [[ ! "$APPROVE" =~ ^[yY]$ ]]; then
        warn "Community Post abgebrochen."
        exit 0
    fi

    # Post
    browser_click "POST" "$PROFILE" || browser_click "POSTEN" "$PROFILE" || true
    wait_seconds 2

    log "Community Post veroeffentlicht!"
    browser_screenshot "youtube-community-post" "$PROFILE"
    notify_telegram "📢 *YouTube Community Post*
$text"
}

# ================================================================
# SHORTS UPLOAD
# ================================================================
cmd_shorts() {
    local video_file="${1:-}"
    local meta_file="${2:-}"

    if [[ -z "$video_file" ]]; then
        error "Usage: ./youtube-studio.sh shorts <video-file> [metadata.json]"
        exit 1
    fi

    step "YouTube Short Upload..."
    log "Short: $video_file"

    # Shorts sind gleicher Flow wie normaler Upload
    # aber mit vertikalem Video (9:16) und max 60 Sekunden
    cmd_upload "$video_file" "$meta_file"
    log "Short Upload via Standard-Upload Flow"
}

# ================================================================
# CHANNEL STATUS
# ================================================================
cmd_status() {
    step "YouTube Kanal-Status..."
    browser_open "$YOUTUBE_STUDIO" "$PROFILE"
    wait_seconds 4

    local snapshot
    snapshot=$(browser_snapshot "$PROFILE")
    browser_screenshot "youtube-status" "$PROFILE"

    log "=== KANAL STATUS ==="

    # Dashboard-Daten extrahieren
    local status_data
    status_data=$(browser_eval "
        const dashboard = document.querySelector('[class*=\"dashboard\"], main, #content');
        dashboard ? dashboard.textContent.trim().substring(0, 500) : 'Dashboard nicht lesbar';
    " "$PROFILE" 2>/dev/null || echo "Status nicht verfuegbar")

    echo "$status_data"

    local logged_in
    logged_in=$(load_from_memory "youtube_logged_in")
    local last_upload
    last_upload=$(load_from_memory "youtube_last_upload")

    echo ""
    log "Login Status: ${logged_in:-unknown}"
    log "Letzter Upload: ${last_upload:-keiner}"
}

# ================================================================
# THUMBNAIL CHANGE
# ================================================================
cmd_thumbnail() {
    local video_url="${1:-}"
    local thumbnail_file="${2:-}"

    if [[ -z "$video_url" ]] || [[ -z "$thumbnail_file" ]]; then
        error "Usage: ./youtube-studio.sh thumbnail <video-edit-url> <thumbnail-image>"
        exit 1
    fi

    if [[ ! -f "$thumbnail_file" ]]; then
        error "Thumbnail nicht gefunden: $thumbnail_file"
        exit 1
    fi

    step "Thumbnail aendern..."
    browser_open "$video_url" "$PROFILE"
    wait_seconds 3

    browser_click "Upload thumbnail" "$PROFILE" || browser_click "Thumbnail hochladen" "$PROFILE" || true
    wait_seconds 1
    browser_upload "$thumbnail_file" "$PROFILE"
    wait_seconds 2

    browser_click "SAVE" "$PROFILE" || browser_click "SPEICHERN" "$PROFILE" || true
    wait_seconds 2

    log "Thumbnail aktualisiert!"
    browser_screenshot "youtube-thumbnail-changed" "$PROFILE"
}

# ================================================================
# MAIN ROUTER
# ================================================================
case "${1:-help}" in
    login)      cmd_login ;;
    upload)     cmd_upload "${2:-}" "${3:-}" ;;
    thumbnail)  cmd_thumbnail "${2:-}" "${3:-}" ;;
    analytics)  cmd_analytics ;;
    comments)   cmd_comments ;;
    community)  cmd_community "${2:-}" ;;
    shorts)     cmd_shorts "${2:-}" "${3:-}" ;;
    status)     cmd_status ;;
    help|*)
        echo ""
        echo "  ROSS — YouTube Studio Browser Automation"
        echo ""
        echo "  Usage: ./youtube-studio.sh <command> [args]"
        echo ""
        echo "  Commands:"
        echo "    login                          — Login-Status pruefen"
        echo "    upload <video> <meta.json>     — Video hochladen"
        echo "    thumbnail <url> <image>        — Thumbnail aendern"
        echo "    analytics                      — Analytics abrufen"
        echo "    comments                       — Kommentare anzeigen"
        echo "    community <text>               — Community Post"
        echo "    shorts <video> [meta.json]     — Short hochladen"
        echo "    status                         — Kanal-Status"
        echo ""
        ;;
esac
