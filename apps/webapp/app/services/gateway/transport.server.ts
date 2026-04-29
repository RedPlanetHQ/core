import { prisma } from "~/db.server";
import {
  Manifest,
  type Manifest as ManifestT,
  HealthResponse,
  type HealthResponse as HealthResponseT,
} from "@redplanethq/gateway-protocol";
import { readSecurityKey } from "./secrets.server";
import { logger } from "~/services/logger.service";

interface ToolResponseEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Map a tool name to the URL group prefix it's registered under in the
 * gateway's Fastify server.
 *   coding_*   → /api/coding
 *   browser_*  → /api/browser
 *   exec_*     → /api/exec
 *   (others)   → /api/utils
 */
function toolGroup(toolName: string): "coding" | "browser" | "exec" | "utils" {
  if (toolName.startsWith("coding_")) return "coding";
  if (toolName.startsWith("browser_")) return "browser";
  if (toolName.startsWith("exec_")) return "exec";
  return "utils";
}

async function authedFetch(
  gw: { id: string; baseUrl: string },
  path: string,
  init?: RequestInit & { timeoutMs?: number },
) {
  const key = await readSecurityKey(gw.id);
  const timeoutMs = init?.timeoutMs ?? 30_000;
  const { timeoutMs: _omit, ...restInit } = init ?? {};
  return fetch(`${gw.baseUrl.replace(/\/$/, "")}${path}`, {
    ...restInit,
    headers: {
      ...(restInit.headers ?? {}),
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Call a tool on a gateway. URL is derived from the tool name prefix:
 *   coding_ask → POST /api/coding/coding_ask
 */
export async function callTool(
  gatewayId: string,
  tool: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<unknown> {
  const gw = await prisma.gateway.findUniqueOrThrow({
    where: { id: gatewayId },
    select: { id: true, baseUrl: true },
  });
  // The gateway's per-tool route expects the request body to BE the tool's
  // parameters (the tool name is already in the URL). No envelope here —
  // the per-route design supersedes the old `/tools/call` envelope.
  const res = await authedFetch(gw, `/api/${toolGroup(tool)}/${tool}`, {
    method: "POST",
    body: JSON.stringify(params ?? {}),
    timeoutMs: timeoutMs + 5_000,
  });
  const text = await res.text();
  let parsed: ToolResponseEnvelope;
  try {
    parsed = JSON.parse(text) as ToolResponseEnvelope;
  } catch {
    throw new Error(
      `gateway ${tool} ${res.status}: ${text || res.statusText}`.trim(),
    );
  }
  if (!res.ok || !parsed.ok) {
    throw new Error(
      `${parsed.error?.code ?? "TOOL_ERROR"}: ${parsed.error?.message ?? text ?? "tool failed"}`,
    );
  }
  return parsed.result;
}

/**
 * Generic helper for the per-gateway settings UI: relay an arbitrary HTTP
 * request to the gateway with auth, return the parsed JSON body. Avoids
 * boilerplate in each proxy route.
 */
export async function gatewayApi<T = unknown>(
  gatewayId: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: T }> {
  const gw = await prisma.gateway.findUniqueOrThrow({
    where: { id: gatewayId },
    select: { id: true, baseUrl: true },
  });
  const res = await authedFetch(gw, path, {
    ...init,
    timeoutMs: init.timeoutMs ?? 30_000,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text || res.statusText };
  }
  return { status: res.status, body: body as T };
}

/**
 * Spawn (or resume) an interactive coding session on the gateway so the
 * browser's xterm WS has a PTY to attach to right away.
 *
 * Calls `POST /api/coding/spawn`:
 *   - No `sessionId` → allocates one, returns it.
 *   - `sessionId` given → reconnect if live, resume from `resumeArgs` otherwise.
 *
 * Returns the concrete sessionId the gateway keyed the PTY to (may differ
 * from the one passed in for codex-cli, where the agent assigns its own id).
 */
export async function spawnCodingSession(
  gatewayId: string,
  params: { agent: string; dir: string; sessionId?: string },
): Promise<{
  sessionId: string;
  pid?: number;
  status: "new" | "reconnect" | "resumed";
}> {
  const gw = await prisma.gateway.findUniqueOrThrow({
    where: { id: gatewayId },
    select: { id: true, baseUrl: true },
  });
  const res = await authedFetch(gw, "/api/coding/spawn", {
    method: "POST",
    body: JSON.stringify(params),
    timeoutMs: 35_000,
  });
  const text = await res.text();
  let body: {
    ok?: boolean;
    sessionId?: string;
    pid?: number;
    status?: "new" | "reconnect" | "resumed";
    error?: string;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(
      `gateway spawn ${res.status}: ${text || res.statusText}`.trim(),
    );
  }
  if (!res.ok || !body.ok || !body.sessionId || !body.status) {
    throw new Error(body.error ?? `gateway spawn failed (${res.status})`);
  }
  return { sessionId: body.sessionId, pid: body.pid, status: body.status };
}

/**
 * Fetch the gateway's manifest (+ etag header). Returns null on any error,
 * leaving the caller free to decide how to flip status.
 */
export async function fetchManifest(
  gatewayId: string,
  timeoutMs = 30_000,
): Promise<{ manifest: ManifestT; etag: string } | null> {
  try {
    const gw = await prisma.gateway.findUniqueOrThrow({
      where: { id: gatewayId },
      select: { id: true, baseUrl: true },
    });
    const res = await authedFetch(gw, "/manifest", {
      method: "GET",
      timeoutMs,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("fetchManifest: non-ok response", {
        gatewayId,
        status: res.status,
        body: body.slice(0, 200),
      });
      return null;
    }
    const etag = res.headers.get("etag") ?? "";
    const manifest = Manifest.parse(await res.json());
    return { manifest, etag };
  } catch (err) {
    logger.warn("fetchManifest: failed", {
      gatewayId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return null;
  }
}

/**
 * Ping the gateway's authenticated health endpoint. Returns null if
 * unreachable or the key is rejected.
 */
export async function fetchHealth(
  gatewayId: string,
  timeoutMs = 30_000,
): Promise<HealthResponseT | null> {
  try {
    const gw = await prisma.gateway.findUniqueOrThrow({
      where: { id: gatewayId },
      select: { id: true, baseUrl: true },
    });
    const res = await authedFetch(gw, "/healthz", { method: "GET", timeoutMs });
    if (!res.ok) return null;
    return HealthResponse.parse(await res.json());
  } catch {
    return null;
  }
}

/**
 * One-shot reachability + key check used during registration. Does NOT read
 * from the DB — the caller passes the raw `securityKey` they received from
 * the user so we can verify before persisting anything.
 *
 * Returns the gateway's self-reported identity on success, null on failure.
 */
export type VerifyGatewayResult =
  | {
      ok: true;
      gatewayId: string | null;
      hostname: string | null;
      platform: string | null;
    }
  | { ok: false; reason: string };

export async function verifyGateway(
  baseUrl: string,
  securityKey: string,
): Promise<VerifyGatewayResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/verify`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${securityKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.name === "TimeoutError" || err.name === "AbortError"
          ? "request timed out after 10s"
          : err.message
        : String(err);
    return {
      ok: false,
      reason: `Could not reach ${url} from the CORE server (${detail}). If you used \`tailscale funnel\`, make sure the funnel is up and publicly reachable.`,
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      reason: "Gateway rejected the security key (401). Re-copy the value from the CLI output and retry.",
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      reason: `Gateway responded ${res.status} at /verify${body ? `: ${body.slice(0, 200)}` : ""}`,
    };
  }

  let body: {
    ok?: boolean;
    gatewayId?: string | null;
    hostname?: string | null;
    platform?: string | null;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return {
      ok: false,
      reason: "Gateway responded 200 but body was not JSON — is the URL pointing at the gateway daemon?",
    };
  }
  if (!body.ok) {
    return {
      ok: false,
      reason: "Gateway returned ok:false at /verify",
    };
  }

  return {
    ok: true,
    gatewayId: body.gatewayId ?? null,
    hostname: body.hostname ?? null,
    platform: body.platform ?? null,
  };
}
