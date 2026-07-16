/**
 * Client for talking to a running CORE gateway daemon (see
 * `@corebrain/cli` — `corebrain gateway start`).
 *
 *   import { Gateway } from "@redplanethq/sdk";
 *   const gw = new Gateway("http://localhost:7787", "gwk_...");
 *   if (await gw.hasCoding()) {
 *     const result = await gw.callTool("coding_ask", { prompt, dir });
 *   }
 *
 * Auth is a single security key (raw form). The gateway compares
 * `sha256(key)` server-side.
 */

// ── Manifest types (inlined to avoid a zod-v4 workspace dep in this v3 SDK) ─
// Kept in sync with packages/gateway-protocol/src/manifest.ts.

export type FolderScope = "files" | "coding" | "exec";

export interface GatewayFolder {
  id: string;
  name: string;
  path: string;
  scopes: FolderScope[];
  gitRepo?: boolean;
}

export interface GatewayToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface AvailableAgent {
  name: string;
  command: string;
  path: string;
  configured: boolean;
}

export type GatewayDeployMode = "native" | "docker" | "railway";

export interface GatewayInfo {
  id: string;
  name: string;
  description?: string;
  version: string;
  platform: string;
  hostname: string;
  deployMode: GatewayDeployMode;
}

export interface GatewayCapabilities {
  browser: { enabled: boolean; engines?: string[] };
  directXterm?: boolean;
}

export interface GatewayManifest {
  protocolVersion: "1";
  gateway: GatewayInfo;
  capabilities: GatewayCapabilities;
  folders: GatewayFolder[];
  tools: GatewayToolDef[];
  agents: string[];
  availableAgents: AvailableAgent[];
}

export interface GatewayHealth {
  status: "ok" | "degraded";
  manifestEtag: string;
  uptimeSec: number;
}

export interface GatewayVerify {
  ok: boolean;
  gatewayId: string | null;
  hostname: string;
  platform: string;
}

// ── Errors ────────────────────────────────────────────────────────────────

export class GatewayError extends Error {
  statusCode?: number;
  code?: string;

  constructor(
    message: string,
    opts: { statusCode?: number; code?: string } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

// ── Types used internally ─────────────────────────────────────────────────

interface ToolEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export interface GatewayOptions {
  /** Default timeout in ms applied to every request. Overridable per call. */
  timeoutMs?: number;
  /** Custom fetch (defaults to global `fetch` — Node 18+ / browser). */
  fetch?: typeof fetch;
  /** How long the manifest is cached in-memory. Default 30 000 ms. */
  manifestTtlMs?: number;
}

// ── Client ────────────────────────────────────────────────────────────────

export class Gateway {
  private baseUrl: string;
  private key: string;
  private defaultTimeoutMs: number;
  private manifestTtlMs: number;
  private fetchImpl: typeof fetch;
  private manifestCache: {
    manifest: GatewayManifest;
    etag: string;
    loadedAt: number;
  } | null = null;

  constructor(baseUrl: string, key: string, opts: GatewayOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.key = key;
    this.defaultTimeoutMs = opts.timeoutMs ?? 30_000;
    this.manifestTtlMs = opts.manifestTtlMs ?? 30_000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  // ── Low-level ──────────────────────────────────────────────────────────

  /**
   * Send an authenticated request to the gateway. Returns the raw Response
   * so callers can decide how to decode (JSON, text, stream).
   */
  async fetch(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const { timeoutMs, headers, ...rest } = init;
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    return this.fetchImpl(url, {
      ...rest,
      headers: {
        ...(headers as Record<string, string> | undefined),
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutMs),
    });
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const res = await this.fetch(path, init);
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new GatewayError(
        `Non-JSON response from ${path} (${res.status}): ${text.slice(0, 200)}`,
        { statusCode: res.status },
      );
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } })
        ?.error;
      throw new GatewayError(err?.message ?? res.statusText, {
        statusCode: res.status,
        code: err?.code,
      });
    }
    return body as T;
  }

  // ── Ops ───────────────────────────────────────────────────────────────

  /** Unauthenticated liveness ping. Returns true if `/healthz/public` answers 200. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/healthz/public`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Authenticated health probe: `{status, manifestEtag, uptimeSec}`. */
  async health(): Promise<GatewayHealth> {
    return this.fetchJson<GatewayHealth>("/healthz");
  }

  /** Identity probe: `{ok, gatewayId, hostname, platform}`. */
  async verify(): Promise<GatewayVerify> {
    return this.fetchJson<GatewayVerify>("/verify");
  }

  // ── Manifest ──────────────────────────────────────────────────────────

  /**
   * Fetch the manifest (cached for `manifestTtlMs`). Pass `{refresh: true}`
   * to bypass the cache.
   */
  async manifest(opts: { refresh?: boolean } = {}): Promise<GatewayManifest> {
    const cached = this.manifestCache;
    if (
      !opts.refresh &&
      cached &&
      Date.now() - cached.loadedAt < this.manifestTtlMs
    ) {
      return cached.manifest;
    }
    const res = await this.fetch("/manifest", { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GatewayError(
        `fetch manifest failed (${res.status}): ${text.slice(0, 200)}`,
        { statusCode: res.status },
      );
    }
    const etag = res.headers.get("etag") ?? "";
    const manifest = (await res.json()) as GatewayManifest;
    this.manifestCache = { manifest, etag, loadedAt: Date.now() };
    return manifest;
  }

  /** Bust the manifest cache so the next capability check re-fetches. */
  invalidate(): void {
    this.manifestCache = null;
  }

  /** Gateway identity block: `{id, name, version, platform, hostname, deployMode}`. */
  async info(): Promise<GatewayInfo> {
    return (await this.manifest()).gateway;
  }

  async tools(): Promise<GatewayToolDef[]> {
    return (await this.manifest()).tools;
  }

  async hasTool(name: string): Promise<boolean> {
    return (await this.tools()).some((t) => t.name === name);
  }

  async folders(): Promise<GatewayFolder[]> {
    return (await this.manifest()).folders;
  }

  /** Configured coding agents on the gateway (keys of `preferences.coding`). */
  async agents(): Promise<string[]> {
    return (await this.manifest()).agents;
  }

  /** Coding agent binaries detected on PATH (may or may not be configured). */
  async availableAgents(): Promise<AvailableAgent[]> {
    return (await this.manifest()).availableAgents;
  }

  // ── Slot / capability helpers ─────────────────────────────────────────
  //
  // The manifest doesn't expose an explicit slot list — its `tools` array
  // is already filtered by `isSlotEnabled()` server-side. So "slot X is on"
  // reduces to "at least one X-prefixed tool is advertised". Browser is the
  // one exception: it has its own `capabilities.browser.enabled` flag.

  async hasCoding(): Promise<boolean> {
    return (await this.tools()).some((t) => t.name.startsWith("coding_"));
  }

  async hasBrowser(): Promise<boolean> {
    return (await this.manifest()).capabilities.browser.enabled;
  }

  async hasExec(): Promise<boolean> {
    return (await this.tools()).some((t) => t.name.startsWith("exec_"));
  }

  async hasFiles(): Promise<boolean> {
    return (await this.tools()).some((t) => t.name.startsWith("files_"));
  }

  /**
   * One-shot snapshot of every capability check plus agents. Useful when
   * you'd otherwise call `hasCoding()` / `hasBrowser()` / etc. back-to-back —
   * this only touches the manifest once.
   */
  async capabilities(): Promise<{
    coding: boolean;
    browser: boolean;
    exec: boolean;
    files: boolean;
    utils: true;
    directXterm: boolean;
    agents: string[];
    availableAgents: AvailableAgent[];
  }> {
    const m = await this.manifest();
    return {
      coding: m.tools.some((t) => t.name.startsWith("coding_")),
      browser: m.capabilities.browser.enabled,
      exec: m.tools.some((t) => t.name.startsWith("exec_")),
      files: m.tools.some((t) => t.name.startsWith("files_")),
      utils: true,
      directXterm: m.capabilities.directXterm ?? false,
      agents: m.agents,
      availableAgents: m.availableAgents,
    };
  }

  // ── Tool invocation ───────────────────────────────────────────────────

  /**
   * Call a gateway tool. The URL group is derived from the tool-name prefix
   * (`coding_*` → `/api/coding`, `browser_*` → `/api/browser`, `exec_*` →
   * `/api/exec`, `files_*` → `/api/files`, everything else → `/api/utils`).
   *
   * Returns the unwrapped `result` field on success; throws `GatewayError`
   * on any non-2xx response or `{ok: false}` envelope.
   */
  async callTool<T = unknown>(
    tool: string,
    params: Record<string, unknown> = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const group = toolGroup(tool);
    const res = await this.fetch(`/api/${group}/${tool}`, {
      method: "POST",
      body: JSON.stringify(params),
      timeoutMs: opts.timeoutMs,
    });
    const text = await res.text();
    let body: ToolEnvelope<T>;
    try {
      body = text
        ? (JSON.parse(text) as ToolEnvelope<T>)
        : { ok: false, error: { code: "EMPTY", message: "empty response" } };
    } catch {
      throw new GatewayError(
        `Non-JSON response from ${tool} (${res.status}): ${text.slice(0, 200)}`,
        { statusCode: res.status },
      );
    }
    if (!res.ok || !body.ok) {
      throw new GatewayError(body.error?.message ?? res.statusText, {
        statusCode: res.status,
        code: body.error?.code,
      });
    }
    return body.result as T;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Mirror of the gateway's route grouping (see packages/cli/src/server/api/server.ts). */
function toolGroup(
  name: string,
): "coding" | "browser" | "exec" | "files" | "utils" {
  if (name.startsWith("coding_")) return "coding";
  if (name.startsWith("browser_")) return "browser";
  if (name.startsWith("exec_")) return "exec";
  if (name.startsWith("files_")) return "files";
  return "utils";
}
