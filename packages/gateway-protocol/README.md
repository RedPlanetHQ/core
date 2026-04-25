# @redplanethq/gateway-protocol

Wire-level types and routes for the **CoreBrain Gateway** — the local
process that runs on a user's machine (or a Docker host) and exposes
their browser, coding agents, and shell to the CORE webapp over HTTP +
WebSocket.

This package is the single source of truth for:

- The protocol version constant.
- The Zod schemas the webapp uses to parse manifest / health / tool
  responses.
- The folder-scope and error-code enums shared between the CLI server
  and the webapp client.

The gateway server lives in [`packages/cli`](../cli) (Fastify). The
client lives in
[`apps/webapp/app/services/gateway`](../../apps/webapp/app/services/gateway).
Both import from this package so the contract stays in one place.

---

## Protocol overview

```
┌──────────────┐   HTTPS / WSS    ┌──────────────────┐
│   webapp     │ ───────────────▶ │   gateway CLI    │
│  (server-    │   Bearer gwk_…   │  Fastify :7787   │
│   side)      │ ◀─────────────── │  per-machine     │
└──────────────┘                  └──────────────────┘
                                       │
                                       ├── Playwright browsers
                                       ├── Coding agent PTYs
                                       └── Shell exec / files
```

- **Transport:** HTTP/1.1 + WebSocket (`@fastify/websocket`).
- **Auth:** every request carries `Authorization: Bearer gwk_<base64url>`.
  The gateway stores only `sha256(key)` on disk, compared in
  constant time. There is **no** loopback / localhost bypass — the
  same flow is used whether the gateway is on `127.0.0.1`, on a
  tunnel, or on a public Docker host.
- **Discovery:** the webapp polls `GET /manifest` on a schedule and
  caches the result. Each manifest carries a `protocolVersion`
  literal (currently `"1"`); a mismatch tells the webapp the gateway
  is too old or too new and the connection is shown as degraded.
- **Versioning:** breaking changes bump `PROTOCOL_VERSION`. Additive
  changes (new tools, new optional manifest fields) do not.

### Auth lifecycle

1. User runs `corebrain gateway register` on the gateway machine. The
   CLI generates a `gwk_<random>` security key, stores
   `sha256(key)` locally, and prints the raw key once.
2. User pastes the raw key (and the gateway's URL) into the webapp's
   *New gateway* dialog. The webapp encrypts and stores the key,
   calls `GET /verify`, and on success persists the gateway record.
3. From then on every request the webapp makes carries
   `Authorization: Bearer <decrypted key>`.

In Docker the security key can be supplied via
`COREBRAIN_GATEWAY_SECURITY_KEY`; if absent on first boot the
gateway generates one and prints it to stdout so it shows up in
`docker logs`.

### Authorization model

The gateway does **not** run a fine-grained permission system —
holding the security key grants every capability the manifest
advertises. Two coarser controls scope what the gateway can do:

- **Slots** — `gateway.slots` toggles each capability (`browser`,
  `coding`, `exec`, `files`) at startup. A disabled slot hides both
  its tools from the manifest and its routes from the HTTP server,
  so a forgotten or stolen key cannot dodge the toggle.
- **Folders** — registered paths with `["files" | "coding" | "exec"]`
  scopes. When at least one folder is registered, exec / coding /
  files tools must operate on a path inside a folder with the
  matching scope. With zero folders the server runs in permissive
  "first-run" mode (matches the laptop dev experience).

---

## TypeScript surface

```ts
import {
  PROTOCOL_VERSION,         // "1"
  Manifest, type Manifest,
  HealthResponse, type HealthResponse,
  Folder, FolderScope,
  GatewayTool,
  ToolCallRequest, ToolCallResponse,
  AvailableAgent, DeployMode,
  GatewayErrorCode,
} from "@redplanethq/gateway-protocol";
```

All schemas are Zod objects — call `.parse(json)` to validate. The
exported `type X` aliases are `z.infer<typeof X>` for ergonomics.

### `Manifest`

```ts
{
  protocolVersion: "1",
  gateway: {
    id: string,           // gateway-assigned id (or "pending")
    name: string,
    version: string,      // CLI version
    platform: string,     // node:os platform()
    hostname: string,
    deployMode: "native" | "docker",
  },
  capabilities: {
    browser: { enabled: boolean, engines?: string[] },
  },
  folders: Folder[],
  tools: GatewayTool[],   // every callable tool, with JSON-schema input
  agents: string[],       // configured coding agent names
  availableAgents: AvailableAgent[],  // detected binaries (configured or not)
}
```

`GatewayTool` is `{ name, description, inputSchema? }` — `inputSchema`
is the tool's JSON-schema `properties` block, useful for surfacing
"what does this tool take" in the UI.

### `HealthResponse`

```ts
{
  status: "ok" | "degraded",
  manifestEtag: string,
  uptimeSec: number,
}
```

`manifestEtag` matches the `etag` header on `GET /manifest`. The
webapp uses it to skip the manifest body fetch when nothing has
changed.

### `Folder`

```ts
{
  id: string,                       // fld_<uuid>
  name: string,                     // unique per gateway
  path: string,                     // absolute, realpath-resolved
  scopes: ("files" | "coding" | "exec")[],
  gitRepo?: boolean,
}
```

### `ToolCallRequest` / `ToolCallResponse`

Legacy single-endpoint envelope (`POST /tools/call`). The current
gateway uses **per-tool routes** (`POST /api/<group>/<toolName>`)
with the body equal to the tool's params and the response shaped
like `ToolCallResponse` minus the echoed `id`. The schemas are kept
exported for older clients and as the canonical response shape.

### `GatewayErrorCode`

`"UNAUTHORIZED" | "TOOL_NOT_FOUND" | "FOLDER_NOT_FOUND" |
"FOLDER_SCOPE_DENIED" | "PATH_OUTSIDE_FOLDER" |
"CAPABILITY_DISABLED" | "TIMEOUT" | "INTERNAL"` — emitted in the
`error.code` field of any failed response.

---

## HTTP / WebSocket routes

All routes require `Authorization: Bearer <securityKey>` except
`GET /healthz/public`. Default port is `7787`, override with
`COREBRAIN_GATEWAY_HTTP_PORT`.

Response envelope for tool routes:

```jsonc
// success
{ "ok": true, "result": <tool-specific> }
// failure
{ "ok": false, "error": { "code": "TOOL_ERROR", "message": "..." } }
```

### Ops (always on)

| Method | Path                | Purpose                                              |
| ------ | ------------------- | ---------------------------------------------------- |
| GET    | `/manifest`         | Full `Manifest`. Response `etag` header for caching. |
| GET    | `/healthz`          | Authed liveness — returns `HealthResponse`.          |
| GET    | `/healthz/public`   | Unauthed liveness (`{status:"ok"}`).                 |
| GET    | `/verify`           | One-shot identity check used during registration.   |

`GET /verify` returns `{ ok, gatewayId, hostname, platform }`. The
webapp uses it to confirm the security key works *before* persisting
the gateway record.

### Coding (`/api/coding`, when `coding` slot enabled)

Per-tool POST routes (body = params, response = tool envelope):

| Path                                  | Tool                       |
| ------------------------------------- | -------------------------- |
| `POST /api/coding/coding_ask`         | Send a prompt to an agent. |
| `POST /api/coding/coding_close_session` | Stop a running session.  |
| `POST /api/coding/coding_close_all`   | Stop all running sessions. |
| `POST /api/coding/coding_read_session` | Read transcript turns.    |
| `POST /api/coding/coding_list_sessions` | Paginated session list.  |
| `POST /api/coding/coding_search_sessions` | Search by title / first message. |
| `POST /api/coding/coding_list_agents` | Configured + default agent. |

Webapp-only PTY primitives (no LLM equivalent):

| Path                                              | Purpose                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/coding/spawn`                          | Allocate or resume a PTY for the xterm WS to attach to.                                 |
| `GET  /api/coding/coding_xterm_session?session_id=…` | WebSocket. Streams PTY output, accepts input + resize frames. Auto-resumes the agent if the PTY is gone. |

`POST /api/coding/spawn` body: `{ agent, dir, sessionId? }` →
`{ ok: true, sessionId, pid, status: "new" | "reconnect" | "resumed" }`.

xterm WS frames:

```jsonc
// server → client (PTY output as raw text frames, plus exit envelope)
{ "kind": "exit", "exitCode": 0, "signal": null }

// client → server (either raw text OR JSON envelope)
{ "kind": "input",  "data":  "echo hi\n" }
{ "kind": "resize", "cols": 120, "rows": 40 }
```

Close codes: `4400` missing `session_id`, `4404` no such session,
`4500` spawn / attach failed, `1000` clean exit.

### Browser (`/api/browser`, when `browser` slot enabled)

Per-tool POST routes (one route per tool listed in the manifest):

```
browser_navigate, browser_snapshot, browser_click, browser_fill,
browser_type, browser_press_key, browser_select_option,
browser_screenshot, browser_wait_for, browser_evaluate,
browser_go_back, browser_go_forward, browser_scroll,
browser_close_session, browser_close_all, browser_list_sessions,
browser_create_session, browser_delete_session
```

Plus two non-tool primitives used by the webapp's browser viewer:

| Path                              | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/browser/launch`        | Lazy-launch (or attach to) a configured session by name. Always headless.              |
| `GET  /api/browser/cdp/:session`  | WebSocket — bidirectional Chrome DevTools Protocol proxy. Text frames only. `4404` if the session is not running, `4502` on upstream error. |

### Exec (`/api/exec`, when `exec` slot enabled)

| Path                       | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `POST /api/exec/exec_command` | Run a shell command. Validated against allow / deny patterns and folder scopes. |

### Files (`/api/files`, when `files` slot enabled)

| Path                       | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `POST /api/files/files_read`  | Read a UTF-8 file with `cat -n` line numbers.                       |
| `POST /api/files/files_write` | Create or overwrite a file (creates parent dirs).                   |
| `POST /api/files/files_edit`  | Replace an exact text region. Match is character-for-character.     |
| `POST /api/files/files_glob`  | Find files by glob, sorted by mtime.                                |
| `POST /api/files/files_grep`  | Ripgrep-backed content search with content / count / files modes.   |

All paths must resolve into a `files`-scoped registered folder when
folders exist.

### Utils (`/api/utils`, always on)

| Path                  | Description                          |
| --------------------- | ------------------------------------ |
| `POST /api/utils/sleep` | Pause execution 1–300 seconds. Useful between polling tool calls. |

### Folders (`/api/folders`, always on)

| Method | Path                          | Purpose                                                                                  |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/folders`                | Mirror of `manifest.folders`.                                                            |
| POST   | `/api/folders/local`          | Register an existing local path. Body: `{ name?, path, scopes? }`.                       |
| POST   | `/api/folders/git`            | `git clone <url>` into the workspace, then register. Body: `{ url, name?, branch? }`. Workspace root is `COREBRAIN_DEFAULT_WORKSPACE` (Docker default `/app`). |
| DELETE | `/api/folders/:idOrName`      | Unregister a folder. Does not delete files on disk.                                       |

### Shell (`/api/shell`, always on)

General-purpose PTY for the per-gateway *Terminal* tab in the
webapp.

| Path                  | Description                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/shell/spawn` | Spawn `$SHELL -il` inside a PTY managed by the same `ptyManager` as coding. Body: `{ cwd? }`. Browser then attaches via `GET /api/coding/coding_xterm_session?session_id=…`. |

---

## Tool call shape

For every per-tool route the request body **is** the tool's params:

```bash
# Example: coding_ask
curl -sX POST http://gateway:7787/api/coding/coding_ask \
  -H "Authorization: Bearer gwk_…" \
  -H "Content-Type: application/json" \
  -d '{
        "agent": "claude-code",
        "dir": "/Users/me/projects/api",
        "prompt": "Fix the auth timeout bug"
      }'
```

The response always conforms to the tool envelope:

```json
{ "ok": true, "result": { "sessionId": "…", "pid": 12345, "status": "new" } }
```

The full input schema for each tool is published in the manifest's
`tools[].inputSchema` so the webapp can render a generic invocation
form without duplicating the contract.

---

## Slot toggles

`preferences.gateway.slots` controls which capability groups boot:

```jsonc
{
  "browser": { "enabled": true },
  "coding":  { "enabled": true },
  "exec":    { "enabled": true,  "allow": ["Bash(git *)"], "deny": ["Bash(rm -rf *)"] },
  "files":   { "enabled": true }
}
```

When a slot's `enabled` flag is `false`:

- the slot's tools are stripped from `manifest.tools`,
- the slot's HTTP routes are not registered (404 instead of 403),
- for `coding`, `manifest.agents` is also empty so UIs do not offer
  agents the user has explicitly disabled.

The exec slot additionally carries the allow / deny pattern lists
checked by `exec_command`. See
[`docs/gateway/exec.mdx`](../../docs/gateway/exec.mdx) for the
pattern grammar.

---

## Deploy modes

`manifest.gateway.deployMode` is set automatically:

- **`native`** — the default. Installed via `npm install -g
  @redplanethq/corebrain` and run as a launchd / systemd service or
  `corebrain gateway start --foreground`.
- **`docker`** — set when `COREBRAIN_DEPLOY_MODE=docker` (the
  `Dockerfile.gateway` does this) or `/.dockerenv` exists. The
  webapp uses the value to gate features — only Docker gateways get
  the *Clone repo* affordance for adding folders, since laptop
  gateways already have the user's repos on disk.

---

## Reference

- Gateway server (Fastify): [`packages/cli/src/server`](../cli/src/server)
- Webapp transport: [`apps/webapp/app/services/gateway`](../../apps/webapp/app/services/gateway)
- User-facing docs: [`docs/gateway`](../../docs/gateway)
- Docker image: [`docker/Dockerfile.gateway`](../../docker/Dockerfile.gateway)
