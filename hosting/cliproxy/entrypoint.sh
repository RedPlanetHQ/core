#!/bin/sh
# Seed CLIProxyAPI's auth-dir from env vars, then launch the server.
#
# Convention:
#   CLIPROXY_AUTH_<name>_B64=<base64-encoded auth JSON>
#     → decoded to /root/.cli-proxy-api/<name>.json
#
# Example (locally): pull the JSONs the login flow wrote, base64 them, and
# paste into your host's env vars:
#   base64 -i ~/.cli-proxy-api/claude-you@example.com.json
#   → CLIPROXY_AUTH_claude_B64=<that string>
#
# CLIProxyAPI walks the whole auth-dir and loads every *.json file, so the
# suffix you pick (`claude`, `codex_work`, `gemini_personal`) is just a label
# — pick whatever you'll recognize later.
#
# Seed-only, never overwrite: if the file already exists on disk (i.e. the
# volume kept a refreshed copy from a previous run), we leave it alone. Access
# tokens rotate on every refresh, so blindly rewriting the env-var version
# would clobber good state. Env vars are a first-boot seed, not the source
# of truth.

set -e

AUTH_DIR="${CLIPROXY_AUTH_DIR:-/root/.cli-proxy-api}"
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"

for var in $(env | awk -F= '/^CLIPROXY_AUTH_.*_B64=/ {print $1}'); do
    name=$(echo "$var" | sed -e 's/^CLIPROXY_AUTH_//' -e 's/_B64$//')
    target="$AUTH_DIR/$name.json"

    if [ -s "$target" ]; then
        echo "[entrypoint] $target already present, skipping seed from \$$var"
        continue
    fi

    value=$(eval "printf '%s' \"\$$var\"")
    if [ -z "$value" ]; then
        continue
    fi

    if ! printf '%s' "$value" | base64 -d > "$target" 2>/dev/null; then
        echo "[entrypoint] ERROR: \$$var is not valid base64" >&2
        rm -f "$target"
        exit 1
    fi

    chmod 600 "$target"
    echo "[entrypoint] seeded $target from \$$var"
done

exec /CLIProxyAPI/CLIProxyAPI --config /CLIProxyAPI/config.yaml "$@"
