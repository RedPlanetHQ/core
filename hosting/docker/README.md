# Docker Compose — CoreBrain Self-Hosted

All commands are run from this directory (`hosting/docker/`).

## Quick start (core stack only)

```bash
cp .env.example .env
# Edit .env — set secrets, AI provider keys, NEO4J_PASSWORD, etc.
docker compose up -d
```

The webapp is available at `http://localhost:3033`.

## Adding the gateway

Run both compose files together with `-f`:

```bash
docker compose -f docker-compose.yaml -f docker-compose.gateway.yaml up -d
```

The gateway container (`corebrain-gateway`) joins the same `core` Docker network as the webapp and is reachable at `http://corebrain-gateway:7787` from other containers. It is exposed on your host at the port set by `COREBRAIN_GATEWAY_HTTP_PORT` (default `7787`).

To stop everything:

```bash
docker compose -f docker-compose.yaml -f docker-compose.gateway.yaml down
```

## Environment variable wiring

Both compose files read from the same `.env` file. The gateway-specific variables are already included in `.env.example`:

| Variable | Where used | Purpose |
|---|---|---|
| `COREBRAIN_GATEWAY_SECURITY_KEY` | gateway container + webapp | Shared secret that authenticates the webapp to the gateway |
| `COREBRAIN_API_KEY` | gateway container | Personal access token from Core → Settings → Tokens |
| `DEFAULT_GATEWAY_URL` | webapp | Internal URL the webapp uses to reach the gateway (`http://corebrain-gateway:7787`) |
| `DEFAULT_GATEWAY_NAME` | webapp | Name stored in DB when auto-registering (default: `local-gateway`) |
| `COREBRAIN_GATEWAY_NAME` | gateway container | Name the gateway reports in its own manifest (default: `cloud-gateway`) |
| `COREBRAIN_GATEWAY_HTTP_PORT` | host port mapping | Host port the gateway listens on (default: `7787`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | gateway container | Long-lived Claude Code token (`claude setup-token`); optional |
| `GITHUB_TOKEN` | gateway container | Token for `git clone` of private repos and author identity; optional |
| `GATEWAY_VERSION` | gateway image tag | Pin to a specific release, e.g. `0.6.4`; omit for `latest` |

The gateway's `COREBRAIN_API_URL` is hardcoded to `http://core:3000` (the webapp's internal address) in `docker-compose.gateway.yaml` — do not set this in `.env`.

## Auto-registration

When both `DEFAULT_GATEWAY_URL` and `COREBRAIN_GATEWAY_SECURITY_KEY` are set in `.env`, the webapp automatically registers the gateway for every new workspace. No manual "Register gateway" step in the UI is needed.

Minimum `.env` additions to enable auto-registration:

```env
COREBRAIN_GATEWAY_SECURITY_KEY=<generate with: openssl rand -hex 32>
COREBRAIN_API_KEY=<your token from Core → Settings → Tokens>
DEFAULT_GATEWAY_URL=http://corebrain-gateway:7787
DEFAULT_GATEWAY_NAME=local-gateway
```

## First-boot note: security key from logs

If `COREBRAIN_GATEWAY_SECURITY_KEY` is left blank in `.env`, the gateway generates a random key on first boot and prints it to stdout:

```bash
docker compose -f docker-compose.yaml -f docker-compose.gateway.yaml logs corebrain-gateway | grep -i "security key"
```

Copy the printed key into `.env` as `COREBRAIN_GATEWAY_SECURITY_KEY`, then either:

- Set `DEFAULT_GATEWAY_URL` and restart so the webapp auto-registers it, **or**
- Register it manually via the workspace gateway UI using that key.

After setting the key in `.env`, re-create the gateway container so it picks up the new value (plain `restart` does not re-read `.env`):

```bash
docker compose -f docker-compose.yaml -f docker-compose.gateway.yaml up -d corebrain-gateway
```
