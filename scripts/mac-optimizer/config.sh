#!/usr/bin/env bash
# config.sh – Konfigurationsdatei-Management

CONFIG_FILE="${CONFIG_FILE:-$HOME/.mac-optimizer/config.toml}"
OPTIMIZER_DIR="${OPTIMIZER_DIR:-$HOME/.mac-optimizer}"

# Standard-Config
DEFAULT_CONFIG=$(cat <<'EOF'
[performance]
# CPU-Threshold in % um Prozesse zu killen (80 = 80%)
cpu_threshold = 80
# RAM-Threshold in % um zu purgen (70 = 70%)
memory_threshold = 70

[disk]
# Minimaler freier Speicher (GB) bevor Time Machine Snapshots gelöscht werden
min_free_gb = 10
# Warnung ab (GB)
warn_free_gb = 5

[cleanup]
# Alter von Temp-Dateien zum Löschen (Tage)
temp_file_age_days = 2
# Minimale Dateigröße zum Löschen (MB)
min_file_size_mb = 100
# Log-Retention (Tage)
log_retention_days = 7

[notifications]
# Benachrichtigungen ein/aus (nur Premium)
enabled = true
# Level: info, warn, error
level = warn

[schedule]
# Intervall in Sekunden (3600 = 1h)
interval_seconds = 3600
# Laufen bei Login
run_at_load = true
EOF
)

mkdir -p "$OPTIMIZER_DIR"

# Config-Datei erstellen wenn nicht vorhanden
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
fi

# Config-Datei lesen und in env-Variablen umwandeln
function load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        return
    fi

    # Einfacher TOML-Parser (ohne externe Dependencies)
    export CPU_THRESHOLD=$(grep "^cpu_threshold" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 80)
    export MEMORY_THRESHOLD=$(grep "^memory_threshold" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 70)
    export MIN_FREE_GB=$(grep "^min_free_gb" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 10)
    export WARN_FREE_GB=$(grep "^warn_free_gb" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 5)
    export TEMP_FILE_AGE_DAYS=$(grep "^temp_file_age_days" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 2)
    export MIN_FILE_SIZE_MB=$(grep "^min_file_size_mb" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 100)
    export LOG_RETENTION_DAYS=$(grep "^log_retention_days" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 7)
    export NOTIFY_ENABLED=$(grep "^enabled" "$CONFIG_FILE" | head -1 | cut -d= -f2 | tr -d ' ' || echo true)
    export NOTIFY_LEVEL=$(grep "^level" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo warn)
    export SCHEDULE_INTERVAL=$(grep "^interval_seconds" "$CONFIG_FILE" | cut -d= -f2 | tr -d ' ' || echo 3600)
}

# Config-Datei anzeigen
function show_config() {
    echo "Config: $CONFIG_FILE"
    cat "$CONFIG_FILE"
}

# Einzelnen Wert setzen
function set_config() {
    local key="$1" value="$2"
    mkdir -p "$OPTIMIZER_DIR"

    if grep -q "^$key" "$CONFIG_FILE" 2>/dev/null; then
        sed -i '' "s/^$key.*/& = $value/" "$CONFIG_FILE"
    else
        echo "$key = $value" >> "$CONFIG_FILE"
    fi
}

# Direkt-Aufruf
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ "${1:-}" == "--show" ]]; then
        show_config
    elif [[ "${1:-}" == "--load" ]]; then
        load_config
        echo "Config geladen:"
        echo "  CPU_THRESHOLD=$CPU_THRESHOLD"
        echo "  MEMORY_THRESHOLD=$MEMORY_THRESHOLD"
        echo "  MIN_FREE_GB=$MIN_FREE_GB"
    elif [[ "${1:-}" == "--set" ]]; then
        set_config "$2" "$3"
        echo "Gespeichert: $2 = $3"
    else
        echo "Usage: config.sh [--show|--load|--set KEY VALUE]"
    fi
fi
