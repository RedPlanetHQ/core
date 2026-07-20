# CoreBrain Gateway — Deployment Guide

The gateway image (`redplanethq/core-gateway`) bundles everything in one
container: the coding agent runtime, a browser slot, and a built-in LLM proxy
(CLIProxyAPI) that lets you use Claude Max, Codex, Antigravity, or xAI
subscriptions as models in CORE — no separate service needed.

---

## Quick start (Railway)

1. New service → **Deploy from Docker image** → `redplanethq/core-gateway:latest`
2. Set the env vars below.
3. Set the Railway **port** to `7787`.
4. On first boot, copy the security key from the logs and register the gateway
   in CORE → Workspace Settings → Gateways.

---

## Required env vars

```
COREBRAIN_API_URL=https://app.getcore.me
COREBRAIN_API_KEY=<your CORE personal access token>
```

## Optional env vars

```
COREBRAIN_GATEWAY_NAME=cloud-gateway
COREBRAIN_GATEWAY_SECURITY_KEY=   # auto-generated on first boot if blank
COREBRAIN_DEPLOY_MODE=railway      # set this on Railway
CLAUDE_CODE_OAUTH_TOKEN=           # claude-code agent auth
OPENAI_API_KEY=                    # codex agent auth
GITHUB_TOKEN=                      # private repo clones
```

---

## Built-in subscription proxy

The gateway exposes CLIProxyAPI at `/llmproxy/v1` on the same port. Use it to
serve Claude Max / Codex / Antigravity / xAI subscriptions as models in CORE.

Full end-to-end flow (deploy → register → CLI → log in) is documented in
**[Use Your Claude / Codex Subscription](../../docs/guides/subscription-proxy.mdx)**.

The short version:

```bash
# on your laptop, after registering the gateway in the CORE webapp
npm install -g @redplanethq/corebrain
corebrain login

corebrain gateway llmproxy --login claude
corebrain gateway llmproxy --login codex
corebrain gateway llmproxy --login antigravity
corebrain gateway llmproxy --login xai
```

Then in CORE → Workspace Settings → Models → BYOK:

| Field | Value |
|---|---|
| **Base URL** | `https://<your-gateway-host>/llmproxy/v1` |
| **API key** | Value of `COREBRAIN_GATEWAY_SECURITY_KEY` |

Pick a model with the `openai/` prefix, e.g. `openai/claude-sonnet-4-6`.
