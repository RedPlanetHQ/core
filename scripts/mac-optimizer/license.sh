#!/usr/bin/env bash
# =============================================================================
# license.sh – Freemium-Lizenzprüfung für Mac Optimizer
# =============================================================================
# Freemium-Modell:
#   FREE    → Basis-Optimierungen (DNS, Temp-Files, Disk-Report, Netzwerk)
#   PREMIUM → Alle Features + Auto-Schedule + Notifications + Config
# =============================================================================

OPTIMIZER_DIR="${OPTIMIZER_DIR:-$HOME/.mac-optimizer}"
LICENSE_FILE="$OPTIMIZER_DIR/license.key"
LICENSE_CACHE="$OPTIMIZER_DIR/.license_cache"
LICENSE_CACHE_TTL=86400  # 24h in Sekunden

# Remote-Validierungs-URL (eigener Server / Gumroad-Hook)
# Kann später gegen echten Endpunkt ausgetauscht werden
LICENSE_API="${LICENSE_API_URL:-https://api.mac-optimizer.io/v1/validate}"

# Gibt 0 zurück wenn Premium, 1 wenn Free
function check_license() {
    # Kein Key → Free-Tier
    if [[ ! -f "$LICENSE_FILE" ]]; then
        export LICENSE_TIER="free"
        return 1
    fi

    local key
    key=$(cat "$LICENSE_FILE" | tr -d '[:space:]')

    # Format-Check: MACOS-XXXX-XXXX-XXXX-XXXX
    if ! [[ "$key" =~ ^MACOS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$ ]]; then
        export LICENSE_TIER="free"
        export LICENSE_REASON="Ungültiges Key-Format"
        return 1
    fi

    # Cache prüfen (vermeidet API-Call bei jedem Start)
    if [[ -f "$LICENSE_CACHE" ]]; then
        local cached_time cached_tier
        cached_time=$(stat -f %m "$LICENSE_CACHE" 2>/dev/null || echo 0)
        local now
        now=$(date +%s)
        if (( now - cached_time < LICENSE_CACHE_TTL )); then
            cached_tier=$(cat "$LICENSE_CACHE" 2>/dev/null)
            if [[ "$cached_tier" == "premium" ]]; then
                export LICENSE_TIER="premium"
                export LICENSE_KEY="$key"
                return 0
            fi
        fi
    fi

    # Online-Validierung (nicht blockierend – Timeout 5s)
    # Wenn API nicht erreichbar → Cache-Ergebnis akzeptieren (Offline-Mode)
    if command -v curl &>/dev/null; then
        local response
        response=$(curl -sf --max-time 5 \
            -H "Content-Type: application/json" \
            -d "{\"key\":\"$key\",\"machine\":\"$(hostname -s | md5)\"}" \
            "$LICENSE_API" 2>/dev/null || echo "offline")

        if [[ "$response" == "offline" ]]; then
            # Offline: letzten Cache-Status nutzen (Kulanzregel: 7 Tage)
            if [[ -f "$LICENSE_CACHE" ]]; then
                local cached_time
                cached_time=$(stat -f %m "$LICENSE_CACHE" 2>/dev/null || echo 0)
                local now
                now=$(date +%s)
                if (( now - cached_time < 604800 )); then
                    export LICENSE_TIER="premium"
                    export LICENSE_KEY="$key"
                    export LICENSE_OFFLINE=1
                    return 0
                fi
            fi
            export LICENSE_TIER="free"
            export LICENSE_REASON="Offline – Key konnte nicht geprüft werden"
            return 1
        fi

        local valid
        valid=$(echo "$response" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' "')

        if [[ "$valid" == "true" ]]; then
            echo "premium" > "$LICENSE_CACHE"
            export LICENSE_TIER="premium"
            export LICENSE_KEY="$key"
            return 0
        else
            local reason
            reason=$(echo "$response" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
            export LICENSE_TIER="free"
            export LICENSE_REASON="${reason:-Key ungültig}"
            return 1
        fi
    fi

    # Kein curl → offline premium aus Cache
    export LICENSE_TIER="free"
    return 1
}

# Key speichern
function save_license_key() {
    local key="$1"
    mkdir -p "$OPTIMIZER_DIR"
    echo "$key" > "$LICENSE_FILE"
    chmod 600 "$LICENSE_FILE"
    # Cache löschen damit sofort neu geprüft wird
    rm -f "$LICENSE_CACHE"
}

# Key entfernen (Downgrade auf Free)
function remove_license_key() {
    rm -f "$LICENSE_FILE" "$LICENSE_CACHE"
    export LICENSE_TIER="free"
}

# Zeigt Tier-Info
function print_license_info() {
    if [[ "${LICENSE_TIER:-free}" == "premium" ]]; then
        echo -e "\033[0;32m✓ PREMIUM aktiviert${LICENSE_OFFLINE:+ (Offline-Modus)}\033[0m"
    else
        echo -e "\033[1;33m○ FREE-Tier\033[0m${LICENSE_REASON:+ – $LICENSE_REASON}"
        echo ""
        echo "  Upgrade auf Premium: https://mac-optimizer.io/upgrade"
        echo "  Premium-Features: Auto-Schedule, Notifications, Kernel-Tuning,"
        echo "                    Spotlight-Fix, Speicher-Optimierung, mehr..."
    fi
}

# Direkt-Aufruf: Key eingeben und prüfen
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ "${1:-}" == "--activate" ]]; then
        echo -n "Lizenz-Key eingeben (MACOS-XXXX-XXXX-XXXX-XXXX): "
        read -r input_key
        input_key=$(echo "$input_key" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')
        save_license_key "$input_key"
        check_license
        print_license_info
    elif [[ "${1:-}" == "--status" ]]; then
        check_license
        print_license_info
    elif [[ "${1:-}" == "--remove" ]]; then
        remove_license_key
        echo "Lizenz entfernt. Du bist jetzt im Free-Tier."
    else
        echo "Usage: license.sh [--activate|--status|--remove]"
    fi
fi
