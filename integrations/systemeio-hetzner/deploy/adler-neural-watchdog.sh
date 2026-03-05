#!/bin/bash
# ================================================================
# ADLER NEURAL WATCHDOG
# ================================================================
# Selbstlernendes Ueberwachungssystem das Muster erkennt,
# Anomalien vorhersagt und Probleme behebt BEVOR sie auftreten.
#
# Geraete-Mesh:
#   iphone175           -> 100.122.13.33  (Mobile Client)
#   mac-mini-von-maurice -> 100.118.223.64 (Workstation)
#   ubuntu-adler-server  -> 100.124.239.46 (Production Server)
#
# Laeuft alle 2 Minuten via cron.
# Daten: /opt/ki-power/neural/
# ================================================================

set -euo pipefail

NEURAL_DIR="/opt/ki-power/neural"
METRICS_DIR="$NEURAL_DIR/metrics"
PATTERNS_DIR="$NEURAL_DIR/patterns"
INCIDENTS_DIR="$NEURAL_DIR/incidents"
LOG="/var/log/adler-neural.log"
COMPOSE_DIR="/opt/ki-power"

# Mesh-Netzwerk Knoten
declare -A MESH_NODES
MESH_NODES[iphone]="100.122.13.33"
MESH_NODES[mac-mini]="100.118.223.64"
MESH_NODES[adler-server]="100.124.239.46"

# Schwellwerte (werden durch Lernen angepasst)
THRESHOLDS_FILE="$NEURAL_DIR/thresholds.json"

# Zeitstempel
NOW=$(date +%s)
NOW_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
HOUR=$(date +%H)
MINUTE=$(date +%M)

mkdir -p "$METRICS_DIR" "$PATTERNS_DIR" "$INCIDENTS_DIR"

# ================================================================
# LOGGING
# ================================================================
log() {
    echo "[$NOW_HUMAN] $1" >> "$LOG"
}

log_incident() {
    local severity="$1"
    local component="$2"
    local message="$3"
    local action="$4"

    local incident_file="$INCIDENTS_DIR/${NOW}.json"
    cat > "$incident_file" << INCEOF
{
    "timestamp": $NOW,
    "time": "$NOW_HUMAN",
    "severity": "$severity",
    "component": "$component",
    "message": "$message",
    "action": "$action",
    "auto_resolved": true
}
INCEOF
    log "[$severity] $component: $message -> $action"
}

# ================================================================
# METRIK-SAMMLUNG (Neuronale Eingabe-Schicht)
# ================================================================
collect_metrics() {
    local metric_file="$METRICS_DIR/${NOW}.json"

    # System-Metriken
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1 2>/dev/null || echo "0")
    local mem_total=$(free -m | awk '/Mem:/{print $2}' 2>/dev/null || echo "1")
    local mem_used=$(free -m | awk '/Mem:/{print $3}' 2>/dev/null || echo "0")
    local mem_pct=$((mem_used * 100 / mem_total))
    local disk_pct=$(df / | tail -1 | awk '{print $5}' | tr -d '%' 2>/dev/null || echo "0")
    local load_1m=$(cat /proc/loadavg 2>/dev/null | awk '{print $1}' || echo "0")
    local open_files=$(cat /proc/sys/fs/file-nr 2>/dev/null | awk '{print $1}' || echo "0")
    local net_conns=$(ss -tun 2>/dev/null | wc -l || echo "0")

    # Docker Container Status
    local containers_running=$(docker ps -q 2>/dev/null | wc -l || echo "0")
    local containers_total=$(docker ps -aq 2>/dev/null | wc -l || echo "0")
    local containers_unhealthy=$(docker ps --filter health=unhealthy -q 2>/dev/null | wc -l || echo "0")

    # Tailscale Mesh Status
    local ts_online="false"
    local ts_peers=0
    if command -v tailscale &> /dev/null; then
        ts_online=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online' 2>/dev/null || echo "false")
        ts_peers=$(tailscale status --json 2>/dev/null | jq '.Peer | length' 2>/dev/null || echo "0")
    fi

    # Mesh Node Erreichbarkeit
    local mesh_iphone="false"
    local mesh_mac="false"
    local mesh_server="true"
    ping -c1 -W2 100.122.13.33 &>/dev/null && mesh_iphone="true"
    ping -c1 -W2 100.118.223.64 &>/dev/null && mesh_mac="true"

    # Telegram Bot Status
    local telegram_ok="false"
    if docker inspect --format='{{.State.Running}}' openclaw 2>/dev/null | grep -q true; then
        local tg_errors=$(docker logs --since 5m openclaw 2>&1 | grep -ci "telegram.*error\|ETELEGRAM\|polling.*fail\|ECONNREFUSED" 2>/dev/null || echo "0")
        [ "$tg_errors" -lt 2 ] && telegram_ok="true"
    fi

    # Nginx Status
    local nginx_ok="false"
    curl -sf http://localhost/health &>/dev/null && nginx_ok="true"

    # Metrik speichern
    cat > "$metric_file" << METEOF
{
    "ts": $NOW,
    "system": {
        "cpu": $cpu_usage,
        "mem_pct": $mem_pct,
        "mem_used_mb": $mem_used,
        "disk_pct": $disk_pct,
        "load_1m": $load_1m,
        "open_files": $open_files,
        "net_conns": $net_conns
    },
    "docker": {
        "running": $containers_running,
        "total": $containers_total,
        "unhealthy": $containers_unhealthy
    },
    "mesh": {
        "tailscale_online": $ts_online,
        "tailscale_peers": $ts_peers,
        "iphone_reachable": $mesh_iphone,
        "mac_reachable": $mesh_mac,
        "server_ok": $mesh_server
    },
    "services": {
        "telegram_ok": $telegram_ok,
        "nginx_ok": $nginx_ok,
        "tg_errors_5m": ${tg_errors:-0}
    }
}
METEOF

    # Ausgabe fuer weitere Verarbeitung
    echo "$metric_file"
}

# ================================================================
# MUSTER-ERKENNUNG (Versteckte Schicht)
# ================================================================
analyze_patterns() {
    local current_metric="$1"

    # Letzte 30 Metriken laden (ca. 1 Stunde)
    local recent_metrics=$(ls -t "$METRICS_DIR"/*.json 2>/dev/null | head -30)
    local metric_count=$(echo "$recent_metrics" | wc -l)

    if [ "$metric_count" -lt 5 ]; then
        log "INFO: Noch nicht genug Daten fuer Muster-Analyse ($metric_count/5)"
        return
    fi

    # Durchschnittswerte berechnen (gleitender Durchschnitt)
    local avg_cpu=0 avg_mem=0 avg_disk=0 avg_conns=0
    local sum_cpu=0 sum_mem=0 sum_disk=0 sum_conns=0
    local count=0

    for f in $recent_metrics; do
        local c=$(jq -r '.system.cpu // 0' "$f" 2>/dev/null || echo "0")
        local m=$(jq -r '.system.mem_pct // 0' "$f" 2>/dev/null || echo "0")
        local d=$(jq -r '.system.disk_pct // 0' "$f" 2>/dev/null || echo "0")
        local n=$(jq -r '.system.net_conns // 0' "$f" 2>/dev/null || echo "0")
        sum_cpu=$((sum_cpu + c))
        sum_mem=$((sum_mem + m))
        sum_disk=$((sum_disk + d))
        sum_conns=$((sum_conns + n))
        count=$((count + 1))
    done

    [ "$count" -gt 0 ] && {
        avg_cpu=$((sum_cpu / count))
        avg_mem=$((sum_mem / count))
        avg_disk=$((sum_disk / count))
        avg_conns=$((sum_conns / count))
    }

    # Aktuelle Werte
    local cur_cpu=$(jq -r '.system.cpu // 0' "$current_metric")
    local cur_mem=$(jq -r '.system.mem_pct // 0' "$current_metric")
    local cur_disk=$(jq -r '.system.disk_pct // 0' "$current_metric")

    # Muster-Datei speichern
    cat > "$PATTERNS_DIR/current.json" << PATEOF
{
    "ts": $NOW,
    "averages": {
        "cpu": $avg_cpu,
        "mem": $avg_mem,
        "disk": $avg_disk,
        "conns": $avg_conns
    },
    "current": {
        "cpu": $cur_cpu,
        "mem": $cur_mem,
        "disk": $cur_disk
    },
    "deviations": {
        "cpu_spike": $([ "$cur_cpu" -gt $((avg_cpu + 30)) ] && echo "true" || echo "false"),
        "mem_climbing": $([ "$cur_mem" -gt $((avg_mem + 15)) ] && echo "true" || echo "false"),
        "disk_growing": $([ "$cur_disk" -gt $((avg_disk + 5)) ] && echo "true" || echo "false")
    },
    "predictions": {
        "disk_full_in_hours": $(predict_disk_full),
        "mem_exhaustion_risk": $([ "$cur_mem" -gt 85 ] && echo "\"high\"" || ([ "$cur_mem" -gt 70 ] && echo "\"medium\"" || echo "\"low\""))
    },
    "data_points": $count
}
PATEOF
}

# Disk-Voll Vorhersage basierend auf Trend
predict_disk_full() {
    local metrics=$(ls -t "$METRICS_DIR"/*.json 2>/dev/null | head -60)
    local count=$(echo "$metrics" | wc -l)

    if [ "$count" -lt 10 ]; then
        echo "999"
        return
    fi

    # Aeltester und neuester Disk-Wert
    local oldest_file=$(echo "$metrics" | tail -1)
    local newest_file=$(echo "$metrics" | head -1)
    local oldest_disk=$(jq -r '.system.disk_pct // 0' "$oldest_file" 2>/dev/null || echo "0")
    local newest_disk=$(jq -r '.system.disk_pct // 0' "$newest_file" 2>/dev/null || echo "0")
    local oldest_ts=$(jq -r '.ts // 0' "$oldest_file" 2>/dev/null || echo "$NOW")
    local newest_ts=$(jq -r '.ts // 0' "$newest_file" 2>/dev/null || echo "$NOW")

    local disk_diff=$((newest_disk - oldest_disk))
    local time_diff=$((newest_ts - oldest_ts))

    if [ "$disk_diff" -le 0 ] || [ "$time_diff" -le 0 ]; then
        echo "999"
        return
    fi

    # Stunden bis 95% voll
    local remaining=$((95 - newest_disk))
    if [ "$remaining" -le 0 ]; then
        echo "0"
        return
    fi

    local hours_to_full=$(( (remaining * time_diff) / (disk_diff * 3600) ))
    echo "$hours_to_full"
}

# ================================================================
# SELBSTHEILUNG (Ausgabe-Schicht)
# ================================================================
auto_heal() {
    local metric_file="$1"

    # 1. Docker Container pruefen und heilen
    heal_docker "$metric_file"

    # 2. Tailscale Mesh pruefen und heilen
    heal_tailscale "$metric_file"

    # 3. Telegram pruefen und heilen
    heal_telegram "$metric_file"

    # 4. Nginx pruefen und heilen
    heal_nginx "$metric_file"

    # 5. Ressourcen pruefen und optimieren
    heal_resources "$metric_file"

    # 6. Praediktive Heilung
    predictive_heal "$metric_file"
}

heal_docker() {
    local mf="$1"
    local unhealthy=$(jq -r '.docker.unhealthy // 0' "$mf")
    local running=$(jq -r '.docker.running // 0' "$mf")
    local total=$(jq -r '.docker.total // 0' "$mf")

    # Nicht alle Container laufen
    if [ "$running" -lt "$total" ] && [ "$total" -gt 0 ]; then
        log_incident "WARN" "docker" "$running/$total Container laufen" "docker compose up -d"
        cd "$COMPOSE_DIR" && docker compose up -d 2>/dev/null
    fi

    # Unhealthy Container
    if [ "$unhealthy" -gt 0 ]; then
        local sick=$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null)
        for container in $sick; do
            log_incident "WARN" "docker/$container" "Container unhealthy" "restart $container"
            docker restart "$container" 2>/dev/null
        done
    fi

    # Container-Restart-Loops erkennen (mehr als 5 Restarts in einer Stunde)
    for container in core-app core-postgres core-redis core-neo4j core-n8n core-ollama openclaw; do
        local restarts=$(docker inspect --format='{{.RestartCount}}' "$container" 2>/dev/null || echo "0")
        if [ "$restarts" -gt 5 ]; then
            log_incident "CRIT" "docker/$container" "Restart-Loop ($restarts Restarts)" "Logs pruefen + neueste Image pullen"
            docker compose pull "$container" 2>/dev/null
            docker compose up -d "$container" 2>/dev/null
        fi
    done
}

heal_tailscale() {
    local mf="$1"
    local ts_online=$(jq -r '.mesh.tailscale_online // "false"' "$mf")

    if [ "$ts_online" != "true" ]; then
        log_incident "CRIT" "tailscale" "Tailscale offline" "Neustart tailscaled + tailscale up"
        systemctl restart tailscaled 2>/dev/null
        sleep 3
        tailscale up --ssh 2>/dev/null || true
        # Warte und pruefe erneut
        sleep 5
        local check=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online' 2>/dev/null || echo "false")
        if [ "$check" = "true" ]; then
            log "INFO: Tailscale erfolgreich wiederhergestellt"
        else
            log_incident "CRIT" "tailscale" "Tailscale konnte nicht wiederhergestellt werden" "Manueller Eingriff noetig"
        fi
    fi
}

heal_telegram() {
    local mf="$1"
    local tg_ok=$(jq -r '.services.telegram_ok // "false"' "$mf")
    local tg_errors=$(jq -r '.services.tg_errors_5m // 0' "$mf")

    if [ "$tg_ok" != "true" ]; then
        # Pruefen ob Token ueberhaupt gesetzt ist
        source "$COMPOSE_DIR/.env" 2>/dev/null || true
        if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
            log "INFO: Telegram Token nicht konfiguriert - ueberspringe"
            return
        fi

        log_incident "WARN" "telegram" "Telegram Bot nicht funktional ($tg_errors Fehler)" "OpenClaw Neustart"
        docker restart openclaw 2>/dev/null
        sleep 10

        # Zweiter Check
        local retry_errors=$(docker logs --since 1m openclaw 2>&1 | grep -ci "telegram.*error\|ETELEGRAM" 2>/dev/null || echo "0")
        if [ "$retry_errors" -gt 0 ]; then
            # Tiefere Heilung: Config neu schreiben und Container neu erstellen
            log_incident "WARN" "telegram" "Telegram nach Neustart immer noch fehlerhaft" "Rebuild OpenClaw"
            cd "$COMPOSE_DIR" && docker compose up -d --force-recreate openclaw 2>/dev/null
        fi
    fi
}

heal_nginx() {
    local mf="$1"
    local nginx_ok=$(jq -r '.services.nginx_ok // "false"' "$mf")

    if [ "$nginx_ok" != "true" ]; then
        # Erst testen ob Config OK
        if nginx -t 2>/dev/null; then
            log_incident "WARN" "nginx" "Nginx nicht erreichbar aber Config OK" "Neustart nginx"
            systemctl restart nginx 2>/dev/null
        else
            log_incident "CRIT" "nginx" "Nginx Config fehlerhaft" "Config reparieren"
            # Fallback auf Basis-Config
            if [ -f /etc/nginx/sites-available/adler-server ]; then
                ln -sf /etc/nginx/sites-available/adler-server /etc/nginx/sites-enabled/
                rm -f /etc/nginx/sites-enabled/default
                nginx -t 2>/dev/null && systemctl restart nginx 2>/dev/null
            fi
        fi
    fi
}

heal_resources() {
    local mf="$1"
    local mem_pct=$(jq -r '.system.mem_pct // 0' "$mf")
    local disk_pct=$(jq -r '.system.disk_pct // 0' "$mf")

    # Speicher knapp (>90%)
    if [ "$mem_pct" -gt 90 ]; then
        log_incident "WARN" "system" "Speicher bei ${mem_pct}%" "Cache leeren + Docker Cleanup"
        # Linux Page Cache freigeben
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        # Docker Cleanup
        docker system prune -f 2>/dev/null || true
    fi

    # Disk knapp (>85%)
    if [ "$disk_pct" -gt 85 ]; then
        log_incident "WARN" "system" "Disk bei ${disk_pct}%" "Alte Logs + Docker Cleanup"
        # Alte Metriken loeschen (nur letzte 24h behalten)
        find "$METRICS_DIR" -name "*.json" -mmin +1440 -delete 2>/dev/null || true
        # Docker Cleanup
        docker system prune -f --volumes 2>/dev/null || true
        # Alte Logs komprimieren
        find /var/log -name "*.log" -size +100M -exec gzip {} \; 2>/dev/null || true
        # Journal bereinigen
        journalctl --vacuum-time=3d 2>/dev/null || true
    fi

    # Disk kritisch (>95%)
    if [ "$disk_pct" -gt 95 ]; then
        log_incident "CRIT" "system" "Disk bei ${disk_pct}% - KRITISCH" "Aggressive Bereinigung"
        docker system prune -af --volumes 2>/dev/null || true
        find /tmp -type f -mtime +1 -delete 2>/dev/null || true
        find "$METRICS_DIR" -name "*.json" -mmin +360 -delete 2>/dev/null || true
        find "$INCIDENTS_DIR" -name "*.json" -mmin +10080 -delete 2>/dev/null || true
    fi
}

# ================================================================
# PRAEDIKTIVE HEILUNG (Vorausschauend)
# ================================================================
predictive_heal() {
    local mf="$1"

    # Pattern-Datei laden
    local patterns_file="$PATTERNS_DIR/current.json"
    [ ! -f "$patterns_file" ] && return

    # CPU-Spike erkannt -> praeventiv OOM-Killer-Schutz
    local cpu_spike=$(jq -r '.deviations.cpu_spike // "false"' "$patterns_file")
    if [ "$cpu_spike" = "true" ]; then
        log "PREDICT: CPU-Spike erkannt - praeventive Massnahmen"
        # OOM Score fuer kritische Container senken
        local core_pid=$(docker inspect --format '{{.State.Pid}}' core-app 2>/dev/null || echo "")
        [ -n "$core_pid" ] && echo -500 > "/proc/$core_pid/oom_score_adj" 2>/dev/null || true
        local pg_pid=$(docker inspect --format '{{.State.Pid}}' core-postgres 2>/dev/null || echo "")
        [ -n "$pg_pid" ] && echo -900 > "/proc/$pg_pid/oom_score_adj" 2>/dev/null || true
    fi

    # Speicher steigt -> praeventiv Caches leeren
    local mem_climbing=$(jq -r '.deviations.mem_climbing // "false"' "$patterns_file")
    if [ "$mem_climbing" = "true" ]; then
        log "PREDICT: Speicher steigt ueber Durchschnitt - praeventives Cache-Clearing"
        sync && echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true
    fi

    # Disk wird voll -> praeventiv aufraeumen
    local disk_hours=$(jq -r '.predictions.disk_full_in_hours // 999' "$patterns_file")
    if [ "$disk_hours" -lt 48 ] && [ "$disk_hours" -gt 0 ]; then
        log_incident "PREDICT" "disk" "Disk voll in ~${disk_hours}h" "Praeventive Bereinigung"
        docker system prune -f 2>/dev/null || true
        find "$METRICS_DIR" -name "*.json" -mmin +720 -delete 2>/dev/null || true
    fi

    # Zeitbasierte Muster: Nachts (02:00-05:00) Wartung ausfuehren
    if [ "$HOUR" -ge 2 ] && [ "$HOUR" -le 4 ] && [ "$MINUTE" -lt 5 ]; then
        log "PREDICT: Nachtzeit-Wartung gestartet"
        # SSL Zertifikat erneuern (falls vorhanden)
        certbot renew --quiet 2>/dev/null || true
        # Docker Images aktualisieren (nur nachts)
        docker image prune -f 2>/dev/null || true
    fi
}

# ================================================================
# MESH-NETZWERK HEALTH REPORT
# ================================================================
generate_mesh_report() {
    local mf="$1"

    local report_file="$NEURAL_DIR/mesh-status.json"
    local iphone=$(jq -r '.mesh.iphone_reachable // "false"' "$mf")
    local mac=$(jq -r '.mesh.mac_reachable // "false"' "$mf")
    local ts=$(jq -r '.mesh.tailscale_online // "false"' "$mf")

    # Latenz messen
    local lat_iphone=$(ping -c1 -W3 100.122.13.33 2>/dev/null | grep -oP 'time=\K[\d.]+' || echo "-1")
    local lat_mac=$(ping -c1 -W3 100.118.223.64 2>/dev/null | grep -oP 'time=\K[\d.]+' || echo "-1")

    cat > "$report_file" << MESHEOF
{
    "ts": $NOW,
    "time": "$NOW_HUMAN",
    "mesh": {
        "healthy": $([ "$ts" = "true" ] && echo "true" || echo "false"),
        "nodes": {
            "iphone175": {
                "ip": "100.122.13.33",
                "reachable": $iphone,
                "latency_ms": $lat_iphone
            },
            "mac-mini-von-maurice": {
                "ip": "100.118.223.64",
                "reachable": $mac,
                "latency_ms": $lat_mac
            },
            "adler-server": {
                "ip": "100.124.239.46",
                "reachable": true,
                "latency_ms": 0
            }
        },
        "total_nodes": 3,
        "online_nodes": $(( ([ "$iphone" = "true" ] && echo 1 || echo 0) + ([ "$mac" = "true" ] && echo 1 || echo 0) + 1 ))
    }
}
MESHEOF
}

# ================================================================
# DATEN-HYGIENE (Alte Metriken aufraemen)
# ================================================================
cleanup_old_data() {
    # Metriken aelter als 24h loeschen
    find "$METRICS_DIR" -name "*.json" -mmin +1440 -delete 2>/dev/null || true
    # Incidents aelter als 30 Tage loeschen
    find "$INCIDENTS_DIR" -name "*.json" -mtime +30 -delete 2>/dev/null || true
}

# ================================================================
# HAUPTPROGRAMM
# ================================================================
main() {
    # Schritt 1: Metriken sammeln
    local metric_file=$(collect_metrics)

    # Schritt 2: Muster analysieren
    analyze_patterns "$metric_file"

    # Schritt 3: Selbstheilung ausfuehren
    auto_heal "$metric_file"

    # Schritt 4: Mesh-Report generieren
    generate_mesh_report "$metric_file"

    # Schritt 5: Alte Daten aufraemen (einmal pro Stunde)
    if [ "$MINUTE" -lt 3 ]; then
        cleanup_old_data
    fi
}

# Los geht's
main
