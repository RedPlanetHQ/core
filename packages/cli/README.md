# @corebrain/cli — Gateway HTTP API

The `corebrain gateway start` command launches a local daemon that serves an HTTP + WebSocket API on `0.0.0.0:7787` (default). Every route lives in `src/server/api/`; this document is the authoritative index.

## Running a gateway

```bash
corebrain login                    # once, per host
corebrain gateway config           # register this host with the control plane
corebrain gateway start            # start as a background service (launchd / systemd)
corebrain gateway start --foreground  # attach to stdout (Docker / Railway)
```

Port override: `COREBRAIN_GATEWAY_HTTP_PORT=8000` or `preferences.gateway.httpPort`.

## Auth

Every request needs a bearer token:

```
Authorization: Bearer <securityKey>
```

The raw key is set by `corebrain gateway register`; the gateway stores `sha256(key)` and compares in constant time. Two exceptions:

- `GET /healthz/public` — no auth.
- `GET /api/coding/coding_xterm_session` — accepts `?ticket=<hmac>&session_id=<id>` in place of Bearer, for browser-direct WebSocket attaches.

Any other request without a valid Bearer returns `401 {ok: false, error: {code: "UNAUTHORIZED", ...}}`.

## Response envelope

Tool routes (POST `/api/{group}/{tool_name}`) return:

```json
{ "ok": true, "result": <tool-specific> }
```

On failure:

```json
{ "ok": false, "error": { "code": "TOOL_ERROR", "message": "..." } }
```

The fastify error handler shapes non-tool errors the same way.

## Slot toggles

The `coding`, `browser`, `exec`, `files` groups are gated by `preferences.gateway.slots.<slot>.enabled`. A disabled slot hides both the manifest entries and the HTTP routes. `utils`, `folders`, `shell` and ops are always on.

Env override: `COREBRAIN_SLOT_<SLOT>=false` (e.g. `COREBRAIN_SLOT_EXEC=false`) wins over the on-disk toggle.

---

## Ops (always on)

| Method | Path | Description |
|---|---|---|
| GET | `/manifest` | Full gateway manifest — tools, folders, agents, capabilities. Emits `etag` header. |
| GET | `/healthz` | Authenticated liveness: `{status, manifestEtag, uptimeSec}`. |
| GET | `/healthz/public` | Unauthenticated ping: `{status: "ok"}`. |
| GET | `/verify` | Identity probe: `{ok, gatewayId, hostname, platform}`. Used during registration. |

Source: `src/server/api/ops.ts`.

---

## `/api/coding` (slot: `coding`)

Drives coding agents (`claude-code`, `codex-cli`, `opencode`) on registered folders.

### Tools

Each is `POST /api/coding/<name>` with a JSON body of the tool's params.

| Tool | Purpose |
|---|---|
| `coding_ask` | Start or continue a session. Body: `{prompt, dir, agent?, sessionId?, model?, systemPrompt?, worktree?, baseBranch?, branch?}`. Poll with `coding_read_session` for output. |
| `coding_read_session` | Read structured conversation turns + `status` (`initializing` / `working` / `idle` / `ended` / `failed`). Body: `{sessionId}`. |
| `coding_list_sessions` | List sessions from on-disk agent transcripts. Body: `{agent?, since?, limit?, offset?}`. |
| `coding_search_sessions` | Search past session titles / first messages. Body: `{query, dir?, limit?}`. |
| `coding_close_session` | Stop a session. Body: `{sessionId}`. |
| `coding_close_all` | Stop every running session and clean up worktrees. Body: `{}`. |
| `coding_list_agents` | Which agents are configured, and which is default. Body: `{}`. |

### Interactive PTY

- `POST /api/coding/spawn` — spawn or resume an agent's TUI so a WebSocket has a PTY to attach to. Body: `{agent, dir, sessionId?}`. Returns `{sessionId, pid, status: "new"|"reconnect"|"resumed"}`. Webapp-only primitive; LLM callers use `coding_ask`.
- `GET /api/coding/coding_xterm_session?session_id=<id>` — **WebSocket**. Attaches to the PTY. Replays a scrollback buffer (≤256 KB), then streams live output. Send raw text or `{"kind":"input","data":"..."}` / `{"kind":"resize","cols":N,"rows":M}` JSON envelopes. Accepts HMAC `?ticket=` for browser-direct attaches.

Source: `src/server/api/coding/`, `src/server/tools/coding-tools.ts`.

---

## `/api/browser` (slot: `browser`)

Playwright-driven Chromium sessions bound to persistent profiles.

### Tools

| Tool | Purpose |
|---|---|
| `browser_navigate` | Go to a URL. |
| `browser_snapshot` | Get an ARIA accessibility tree — call before interacting to discover element refs. |
| `browser_click` | Click by text description or ref. |
| `browser_fill` | Clear then fill an input. |
| `browser_type` | Type character-by-character (real-user simulation). |
| `browser_press_key` | Press a key (Enter, Tab, ArrowDown, etc.). |
| `browser_select_option` | Choose a `<select>` option. |
| `browser_screenshot` | Base64 PNG of the viewport. |
| `browser_wait_for` | Wait on `load` / `domcontentloaded` / `networkidle`. |
| `browser_evaluate` | Run a JS expression in the page context. |
| `browser_go_back` / `browser_go_forward` | History navigation. |
| `browser_scroll` | Scroll by pixels. |
| `browser_list_sessions` | List configured sessions, their profiles, and live status. |
| `browser_create_session` | Bind a new session name to a profile. Body: `{session, profile}`. |
| `browser_delete_session` | Remove a session from config (closes it if running; profile data preserved). |
| `browser_close_session` | Close a live session (config kept). |
| `browser_close_all` | Close every running session. |

### Live view + lifecycle

- `POST /api/browser/launch` — lazy-launch (or reattach to) a session by name. Body: `{session}`. Always headless — live view goes over CDP.
- `GET /api/browser/cdp/:session` — **WebSocket** proxy for Chrome DevTools Protocol. Pipes frames between the client and the headless Chromium's `--remote-debugging-port`. Closes with `4404` if the session isn't running, `4502` if the upstream handshake fails.

Source: `src/server/api/browser/`, `src/server/tools/browser-tools.ts`.

---

## `/api/exec` (slot: `exec`)

- `POST /api/exec/exec_command` — run a shell command. Enforces the `slots.exec.allow` / `slots.exec.deny` patterns from preferences.

Source: `src/server/api/exec/`, `src/server/tools/exec-tools.ts`.

---

## `/api/files` (slot: `files`)

Scoped to folders registered with the `files` scope.

| Tool | Purpose |
|---|---|
| `files_read` | Read a file as UTF-8 with `cat -n` style line numbers. |
| `files_write` | Create or overwrite a file (parent dirs auto-created). |
| `files_edit` | Replace an exact string region. Fails on non-unique matches unless `replace_all: true`. |
| `files_glob` | Glob search; returns absolute paths sorted by mtime (newest first). |
| `files_grep` | Ripgrep over file contents. Supports `path` / `glob` / `type` filters, three output modes, context lines. Requires `rg` on PATH. |

Source: `src/server/api/files/`, `src/server/tools/files-tools.ts`.

---

## `/api/utils` (always on)

- `POST /api/utils/sleep` — pause for 1–300 seconds. Body: `{seconds, reason?}`.

Source: `src/server/api/utils/`, `src/server/tools/utils-tools.ts`.

---

## `/api/folders` (always on)

Register the on-disk paths the gateway is allowed to touch.

| Method | Path | Body / Params | Description |
|---|---|---|---|
| GET | `/api/folders` | — | List registered folders. |
| POST | `/api/folders/local` | `{name?, path, scopes?}` | Register an existing directory. `scopes` defaults to `["files","coding","exec"]`. |
| POST | `/api/folders/git` | `{name?, url, branch?}` | `git clone --depth 1` into `COREBRAIN_DEFAULT_WORKSPACE` (default `/app`) and register the result. |
| DELETE | `/api/folders/:idOrName` | — | Unregister. Does not delete files. |

Source: `src/server/api/folders/index.ts`.

---

## `/api/shell` (always on)

Singleton PTY for the webapp Terminal tab.

- `POST /api/shell/spawn` — spawn or reattach. Body: `{cwd?, fresh?}`. Returns `{sessionId, pid, resumed}`. Resolves shell in order `$SHELL → /bin/zsh → /bin/bash → /bin/sh`. Attach to the returned `sessionId` over `/api/coding/coding_xterm_session` (same PTY manager).

Source: `src/server/api/shell/index.ts`.

---

## Manifest shape

`GET /manifest` returns a validated `Manifest` (schema in `@redplanethq/gateway-protocol`):

```ts
{
  protocolVersion: "1",
  gateway: { id, name, description?, version, platform, hostname, deployMode },
  capabilities: {
    browser: { enabled, engines?: string[] },
    directXterm?: boolean,   // HMAC-ticket xterm auth supported
  },
  folders: Folder[],          // registered on-disk paths + scopes
  tools: GatewayTool[],       // one per enabled tool, name/description/inputSchema
  agents: string[],           // configured coding agents
  availableAgents: AvailableAgent[],  // detected on PATH
}
```

`deployMode` is `native` / `docker` / `railway`, derived from `COREBRAIN_DEPLOY_MODE` or `/.dockerenv`.

---

## Errors

Consistent envelope on any failure:

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED" | "TOOL_ERROR" | "INTERNAL" | "...", "message": "..." } }
```

Common statuses:

| Status | When |
|---|---|
| 400 | Missing or invalid params (zod validation, missing required body field). |
| 401 | Bearer / ticket verification failed. |
| 403 | Folder scope check rejected the path. |
| 404 | Resource not found (session, folder, browser session). |
| 500 | Internal — see gateway log (`~/.corebrain/logs/gateway.log`). |
| 502 | Upstream failure (git clone, CDP handshake). |

For WebSocket routes, close codes carry the same signal: `4400` (bad request), `4404` (not found), `4500` (server error), `4502` (upstream error), `1000` (normal close).
