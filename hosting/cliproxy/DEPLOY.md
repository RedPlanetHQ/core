# Deploying `redplanethq/cliproxy` (OAuth, headless)

This directory publishes a wrapper image around
[`eceasy/cli-proxy-api`](https://github.com/router-for-me/CLIProxyAPI) that lets
you seed OAuth tokens through env vars, so the container boots
pre-authenticated on Railway / Fly / a plain VPS — no interactive
`--*-login` step inside the container, no SSH tunnels.

Everything here uses the **OAuth subscription** path (Claude Max / ChatGPT
Plus / Codex / Gemini). No API keys involved.

> ⚠ Same ToS caveat as `docker-compose.yaml`: subscription plans are licensed
> for interactive use. Personal self-host is fine; serving other users can get
> your OAuth tokens revoked.

## 1. Log in locally, once per subscription

Boot the upstream image locally (this repo's `docker-compose.yaml` already
wires up the OAuth callback ports on `127.0.0.1`) and run each login:

```bash
docker compose -f hosting/cliproxy/docker-compose.yaml up -d

docker compose exec cli-proxy-api \
  /CLIProxyAPI/CLIProxyAPI -no-browser --claude-login
# repeat for --codex-login, --gemini-login, --qwen-login, --iflow-login
```

Each login writes one JSON file to `/root/.cli-proxy-api/` inside the
container, named `<provider>-<email>.json`. That file holds the OAuth
`access_token` + `refresh_token`; cliproxy rotates the access token
automatically as long as the refresh token stays valid.

## 2. Base64 each auth JSON

Pull the files out and encode them:

```bash
docker exec cli-proxy-api sh -c 'cat /root/.cli-proxy-api/claude-you@example.com.json' \
  | base64 | tr -d '\n'
```

Do this once per subscription you want to expose in the deployment.

## 3. Set env vars on your host

Convention: `CLIPROXY_AUTH_<name>_B64` → decoded to
`/root/.cli-proxy-api/<name>.json` at container startup. The `<name>` is a
label you pick; it just needs to be a valid env var suffix and unique per
account.

Example Railway / Fly / docker env vars:

```
CLIPROXY_AUTH_claude_B64=eyJpZF90b2tlbiI6...
CLIPROXY_AUTH_codex_B64=eyJhY2Nlc3Nfd...
CLIPROXY_AUTH_gemini_B64=...
```

## 4. Deploy the image

The workflow at `.github/workflows/build-cliproxy-image.yml` publishes:

- `redplanethq/cliproxy:latest` — on every push to `main` that touches
  `hosting/cliproxy/**`
- `redplanethq/cliproxy:<version>` — when you push a
  `cliproxy-<version>` git tag (e.g. `cliproxy-0.1.0` → `:0.1.0`)

### Railway

- New service → **Deploy from Docker image** → `redplanethq/cliproxy:latest`
- **Port**: `8317` (Railway assigns a public HTTPS URL)
- **Volume** (recommended): mount at `/root/.cli-proxy-api` so refreshed
  access tokens survive restarts. The entrypoint only seeds files that don't
  already exist, so the volume is the source of truth after first boot.
- **Env vars**: `CLIPROXY_AUTH_*_B64` plus rotate the `api-keys` value in
  `config.yaml` before shipping (see below).

### Anywhere else

Same shape — mount a volume at `/root/.cli-proxy-api`, set the env vars,
expose port `8317`.

## 5. Wire into CORE

Workspace Settings → Models → BYOK for the OpenAI provider:

- **Base URL**: `https://<your-host>/v1`
- **API key**: the value from `api-keys:` in `config.yaml`

Then set the workspace model with the `openai/` prefix to route through the
proxy, e.g. `openai/claude-sonnet-4-6`.

## Seed semantics — read this once

The entrypoint's rule: **env vars are a first-boot seed, not the source of
truth.** For each `CLIPROXY_AUTH_<name>_B64`:

- If `/root/.cli-proxy-api/<name>.json` already exists → skip (respect the
  refreshed copy on the volume)
- If it doesn't exist → decode the base64 and write it

This matters because cliproxy rotates the access token on every refresh and
writes the new value to disk. Without a volume, that refreshed state is lost
on restart and you fall back to the (still-valid) seed. With a volume, the
seed is used exactly once — on the first boot after you add a new
subscription.

If you ever need to force-reseed (e.g. after re-doing an OAuth login on your
laptop and pushing a new base64), delete the file on the volume first, then
restart.

## Rebuilding after upstream changes

The Dockerfile pins `eceasy/cli-proxy-api:latest`. Kick the workflow via
**Actions → Build CLIProxy Image → Run workflow** to pull the newest upstream
and republish `redplanethq/cliproxy:latest`.
