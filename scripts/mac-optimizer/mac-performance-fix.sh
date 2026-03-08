#!/usr/bin/env bash
# =============================================================================
# mac-performance-fix.sh
# Automatische Mac-Performance-Optimierung
# Behebt häufige Ursachen für einen langsamen oder hängenden Mac
# =============================================================================

set -euo pipefail

# --- Konfiguration -----------------------------------------------------------
LOG_DIR="$HOME/Library/Logs/mac-optimizer"
LOG_FILE="$LOG_DIR/fix-$(date +%Y-%m-%d).log"
MAX_CPU_PERCENT=80        # Prozesse mit mehr als X% CPU werden gewarnt
MAX_LOG_AGE_DAYS=7        # Alte Log-Dateien nach X Tagen löschen
MAX_LOG_FILE_MB=100       # System-Logs bis zu X MB bereinigen (~/Library/Logs)
DRY_RUN=${DRY_RUN:-0}     # DRY_RUN=1 für Testlauf ohne echte Änderungen

# --- Hilfsfunktionen ---------------------------------------------------------
mkdir -p "$LOG_DIR"

log() {
    local level="$1"; shift
    local msg="$*"
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] [$level] $msg" | tee -a "$LOG_FILE"
}

info()    { log "INFO " "$@"; }
warn()    { log "WARN " "$@"; }
success() { log "OK   " "$@"; }
section() { echo "" | tee -a "$LOG_FILE"; log "=====" "--- $* ---"; }

run() {
    if [[ "$DRY_RUN" == "1" ]]; then
        info "[DRY-RUN] $*"
    else
        eval "$@" >> "$LOG_FILE" 2>&1 && return 0 || return 1
    fi
}

require_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        echo "FEHLER: Dieses Skript läuft nur auf macOS." >&2
        exit 1
    fi
}

# --- 1. Hängende Prozesse erkennen und beenden ------------------------------
fix_hung_processes() {
    section "Hängende Prozesse"

    # Prozesse im Status "Not Responding" (Spinning Beach Ball)
    local hung
    hung=$(ps aux | awk '$8 ~ /^Z/' | grep -v PID || true)  # Zombie-Prozesse
    if [[ -n "$hung" ]]; then
        warn "Zombie-Prozesse gefunden:"
        echo "$hung" | tee -a "$LOG_FILE"
        while IFS= read -r line; do
            local pid
            pid=$(echo "$line" | awk '{print $2}')
            warn "Beende Zombie-Prozess PID $pid"
            run "kill -9 $pid" || true
        done <<< "$hung"
    else
        success "Keine Zombie-Prozesse gefunden."
    fi

    # Prozesse mit extrem hoher CPU-Last (>MAX_CPU_PERCENT)
    info "Prüfe Prozesse mit CPU > ${MAX_CPU_PERCENT}%..."
    local high_cpu
    high_cpu=$(ps aux | awk -v threshold="$MAX_CPU_PERCENT" \
        'NR>1 && $3+0 > threshold {print $2, $3, $11}' | head -10 || true)
    if [[ -n "$high_cpu" ]]; then
        warn "Prozesse mit hoher CPU-Last (>${MAX_CPU_PERCENT}%):"
        echo "$high_cpu" | while read -r pid cpu name; do
            warn "  PID=$pid CPU=${cpu}% NAME=$name"
        done
    else
        success "Kein Prozess überschreitet ${MAX_CPU_PERCENT}% CPU."
    fi
}

# --- 2. DNS-Cache leeren -----------------------------------------------------
fix_dns_cache() {
    section "DNS-Cache"
    if run "sudo dscacheutil -flushcache"; then
        success "dscacheutil Cache geleert."
    fi
    if run "sudo killall -HUP mDNSResponder 2>/dev/null"; then
        success "mDNSResponder neugestartet."
    fi
}

# --- 3. System-RAM-Druck reduzieren (Purge) ----------------------------------
fix_memory() {
    section "Arbeitsspeicher"

    local mem_pressure
    # memory_pressure gibt "System-wide memory free percentage: X%" aus
    mem_pressure=$(memory_pressure 2>/dev/null | grep "System-wide" | awk '{print $NF}' | tr -d '%' || echo "?")
    info "Aktueller Speicher-Druck: ${mem_pressure}% frei"

    # Inaktive Seiten aus dem RAM entfernen (benötigt sudo)
    if run "sudo purge"; then
        success "Inaktive RAM-Seiten freigegeben (purge)."
    fi

    # Swap-Nutzung anzeigen
    local swap_info
    swap_info=$(sysctl vm.swapusage 2>/dev/null || echo "n/a")
    info "Swap: $swap_info"
}

# --- 4. Temporäre Dateien bereinigen ----------------------------------------
fix_temp_files() {
    section "Temporäre Dateien"

    local dirs_to_clean=(
        "$TMPDIR"
        "/private/var/folders"   # Systemweite Temp-Ordner
        "$HOME/Library/Caches"
        "$HOME/Library/Logs"
    )

    for dir in "${dirs_to_clean[@]}"; do
        if [[ -d "$dir" ]]; then
            # Nur Dateien älter als 2 Tage löschen, keine versteckten Systemdateien
            local deleted_count
            deleted_count=$(find "$dir" -maxdepth 3 -type f -atime +2 \
                ! -name "*.plist" ! -name "*.db" \
                -size +"$MAX_LOG_FILE_MB"M 2>/dev/null | wc -l | tr -d ' ')
            if [[ "$deleted_count" -gt 0 ]]; then
                info "Bereinige $deleted_count große Dateien (>$MAX_LOG_FILE_MB MB) in $dir ..."
                run "find '$dir' -maxdepth 3 -type f -atime +2 \
                    ! -name '*.plist' ! -name '*.db' \
                    -size +${MAX_LOG_FILE_MB}M -delete 2>/dev/null || true"
                success "$deleted_count Dateien in $dir entfernt."
            else
                info "Keine großen alten Dateien in $dir."
            fi
        fi
    done

    # Xcode DerivedData (oft mehrere GB groß)
    local xcode_derived="$HOME/Library/Developer/Xcode/DerivedData"
    if [[ -d "$xcode_derived" ]]; then
        local xcode_size
        xcode_size=$(du -sh "$xcode_derived" 2>/dev/null | awk '{print $1}')
        info "Xcode DerivedData: $xcode_size – bereinige..."
        run "rm -rf '$xcode_derived'/*" || true
        success "Xcode DerivedData bereinigt."
    fi

    # Alte eigene Optimizer-Logs bereinigen
    find "$LOG_DIR" -name "fix-*.log" -mtime +"$MAX_LOG_AGE_DAYS" -delete 2>/dev/null || true
    success "Alte Optimizer-Logs (>${MAX_LOG_AGE_DAYS} Tage) entfernt."
}

# --- 5. Spotlight reparieren (falls hängend) ---------------------------------
fix_spotlight() {
    section "Spotlight"

    # mdworker-Prozesse überprüfen
    local mdworker_count
    mdworker_count=$(pgrep -c mdworker 2>/dev/null || echo 0)
    info "Aktive mdworker-Prozesse: $mdworker_count"

    if [[ "$mdworker_count" -gt 20 ]]; then
        warn "Zu viele mdworker-Prozesse ($mdworker_count). Spotlight-Index wird neu aufgebaut..."
        run "sudo mdutil -E /" || true
        success "Spotlight-Index wird neu aufgebaut."
    else
        success "Spotlight-Prozesse normal ($mdworker_count)."
    fi
}

# --- 6. Festplatten-Status prüfen -------------------------------------------
fix_disk() {
    section "Festplatte"

    # Freier Speicher
    local free_gb
    free_gb=$(df -g / | awk 'NR==2{print $4}')
    info "Freier Speicher auf /: ${free_gb} GB"

    if [[ "$free_gb" -lt 5 ]]; then
        warn "Weniger als 5 GB frei! Performance kann stark beeinträchtigt sein."
        warn "Tipp: Führe 'du -sh ~/Downloads/* | sort -rh | head -20' aus."
    else
        success "Genug freier Speicher (${free_gb} GB)."
    fi

    # APFS-Snapshot-Größen anzeigen (Time Machine Snapshots)
    info "Lokale Time-Machine-Snapshots:"
    tmutil listlocalsnapshots / 2>/dev/null | tee -a "$LOG_FILE" || info "(Keine lokalen Snapshots gefunden)"

    # Älteste lokale Snapshot löschen falls Speicher knapp
    if [[ "$free_gb" -lt 10 ]]; then
        warn "Speicher knapp – lösche älteste lokale Time-Machine-Snapshots..."
        local oldest_snap
        oldest_snap=$(tmutil listlocalsnapshots / 2>/dev/null | head -1 || true)
        if [[ -n "$oldest_snap" ]]; then
            run "tmutil deletelocalsnapshots '$oldest_snap'" || true
            success "Snapshot $oldest_snap gelöscht."
        fi
    fi
}

# --- 7. Kernel-Extensions und Login-Items melden ----------------------------
report_startup_items() {
    section "Login-Items & Startup"
    info "Aktuelle Login-Items (sfltool):"
    sfltool dumpbtm 2>/dev/null | grep -E "(BundleID|URL|Status)" | head -30 \
        | tee -a "$LOG_FILE" || info "(sfltool nicht verfügbar – macOS < 13)"
}

# --- 8. Netzwerk-Stack zurücksetzen ------------------------------------------
fix_network() {
    section "Netzwerk"
    # Nur wenn Netzwerkprobleme vorliegen (Ping-Test)
    if ! ping -c 1 -t 2 8.8.8.8 &>/dev/null; then
        warn "Keine Internetverbindung. Versuche Netzwerk-Reset..."
        run "sudo ifconfig en0 down && sudo ifconfig en0 up" || true
        run "sudo route flush" || true
        success "Netzwerk-Interface zurückgesetzt."
    else
        success "Netzwerkverbindung OK."
    fi
}

# --- 9. Kernel-Parameter optimieren (sysctl) --------------------------------
fix_kernel_params() {
    section "Kernel-Parameter"

    # Maximale offene Dateien erhöhen (behebt "Too many open files"-Fehler)
    local current_maxfiles
    current_maxfiles=$(sysctl -n kern.maxfiles 2>/dev/null || echo "n/a")
    info "kern.maxfiles: $current_maxfiles"

    if [[ "$current_maxfiles" != "n/a" && "$current_maxfiles" -lt 65536 ]]; then
        run "sudo sysctl -w kern.maxfiles=65536" || true
        run "sudo sysctl -w kern.maxfilesperproc=32768" || true
        success "kern.maxfiles auf 65536 erhöht."
    else
        success "kern.maxfiles bereits ausreichend ($current_maxfiles)."
    fi
}

# --- Hauptprogramm -----------------------------------------------------------
main() {
    require_macos

    echo "" | tee -a "$LOG_FILE"
    info "=========================================================="
    info "  Mac Performance Auto-Fix gestartet"
    info "  $(date)"
    info "  macOS $(sw_vers -productVersion) | $(uname -m)"
    info "  DRY_RUN=$DRY_RUN"
    info "=========================================================="

    fix_hung_processes
    fix_memory
    fix_disk
    fix_dns_cache
    fix_temp_files
    fix_spotlight
    fix_network
    fix_kernel_params
    report_startup_items

    section "Zusammenfassung"
    success "Alle Checks abgeschlossen. Log: $LOG_FILE"
    info "Tipp: Für automatische Ausführung: ./install-launchagent.sh"
}

main "$@"
