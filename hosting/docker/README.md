# Docker Compose — CoreBrain Self-Hosted

All commands below are run from the **repo root** (or adjust paths accordingly).

## Quick start (core stack only)

```bash
cd hosting/docker
cp .env.example .env
# Edit .env — set secrets, AI provider keys, NEO4J_PASSWORD, etc.
docker compose up -d
```

The webapp is available at `http://localhost:3033`.

## Adding the gateway

Run the core stack and the gateway together using two `-f` flags:

```bash
docker compose \
  -f hosting/docker/docker-compose.yaml \
  -f hosting/gateway/docker-compose.yaml \
  up -d
```

Docker Compose reads `.env` from the directory of the first `-f` file (`hosting/docker/`), so a single `hosting/docker/.env` covers both services.

To stop everything:

```bash
docker compose \
  -f hosting/docker/docker-compose.yaml \
  -f hosting/gateway/docker-compose.yaml \
  down
```

### Network note

The gateway runs in its own Docker network segment and reaches the webapp over the **host-exposed port** (`3033`), not the internal Docker network. Set `COREBRAIN_API_URL` accordingly:

| Environment | `COREBRAIN_API_URL` value |
|---|---|
| Docker Desktop (Mac / Windows) | `http://host.docker.internal:3033` |
| Linux — add `extra_hosts` (see below) | `http://host.docker.internal:3033` |
| Remote server | `https://your-core-domain.example.com` |

For Linux, add this to the `corebrain-gateway` service in a local override, or set it in `.env` and rely on the OS-level hostname:

```yaml
# hosting/gateway/docker-compose.override.yaml  (local only, git-ignored)
services:
  corebrain-gateway:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

## Environment variable wiring

Both compose files read from `hosting/docker/.env`. The gateway-specific variables are included in `.env.example`:

| Variable | Where used | Purpose |
|---|---|---|
| `COREBRAIN_API_URL` | gateway container | URL of the CORE webapp (see network note above) |
| `COREBRAIN_API_KEY` | gateway container | Personal access token from Core → Settings → Tokens |
| `COREBRAIN_GATEWAY_SECURITY_KEY` | gateway container | Security key the gateway uses for its own identity |
| `COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY` | webapp | Same key value — used by the webapp to verify and register the gateway |
| `COREBRAIN_DEFAULT_GATEWAY_URL` | webapp | URL the webapp uses to reach the gateway (same host note applies) |
| `COREBRAIN_DEFAULT_GATEWAY_NAME` | webapp | Name stored in DB when auto-registering (default: `local-gateway`) |
| `COREBRAIN_GATEWAY_HTTP_PORT` | host port mapping | Host port the gateway listens on (default: `7787`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | gateway container | Long-lived Claude Code token (`claude setup-token`); optional |
| `GITHUB_TOKEN` | gateway container | Token for `git clone` of private repos; optional |
| `GATEWAY_VERSION` | gateway image tag | Pin to a specific release, e.g. `0.6.4`; omit for `latest` |

## Auto-registration

When both `COREBRAIN_DEFAULT_GATEWAY_URL` and `COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY` are set, the webapp automatically registers the gateway for every new workspace. No manual "Register gateway" step in the UI is needed.

Minimum `.env` additions to enable auto-registration (Docker Desktop example):

```env
COREBRAIN_GATEWAY_SECURITY_KEY=<generate with: openssl rand -hex 32>
COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY=<same value as above>
COREBRAIN_API_KEY=<your token from Core → Settings → Tokens>
COREBRAIN_API_URL=http://host.docker.internal:3033
COREBRAIN_DEFAULT_GATEWAY_URL=http://host.docker.internal:7787
COREBRAIN_DEFAULT_GATEWAY_NAME=local-gateway
```

## First-boot note: security key from logs

If `COREBRAIN_GATEWAY_SECURITY_KEY` is left blank in `.env`, the gateway generates a random key on first boot and prints it to stdout:

```bash
docker compose \
  -f hosting/docker/docker-compose.yaml \
  -f hosting/gateway/docker-compose.yaml \
  logs corebrain-gateway | grep -i "security key"
```

Copy the printed key into `.env` as both `COREBRAIN_GATEWAY_SECURITY_KEY` and `COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY`, then either:

- Set `COREBRAIN_DEFAULT_GATEWAY_URL` and create a new workspace so the webapp auto-registers it, **or**
- Register it manually via the workspace gateway UI using that key and the gateway's public URL.

After updating `.env`, re-create the gateway container so it picks up the new value (`restart` does not re-read `.env`):

```bash
docker compose \
  -f hosting/docker/docker-compose.yaml \
  -f hosting/gateway/docker-compose.yaml \
  up -d corebrain-gateway
```
