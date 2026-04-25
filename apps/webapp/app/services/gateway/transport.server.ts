import { prisma } from "~/db.server";
import {
  Manifest,
  type Manifest as ManifestT,
  HealthResponse,
  type HealthResponse as HealthResponseT,
} from "@core/gateway-protocol";
import { readSecurityKey } from "./secrets.server";

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
  const {
    timeoutMs: _omit,
    ...restInit
  } = init ?? {};
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
  const res = await authedFetch(
    gw,
    `/api/${toolGroup(tool)}/${tool}`,
    {
      method: "POST",
      body: JSON.stringify(params ?? {}),
      timeoutMs: timeoutMs + 5_000,
    },
  );
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
  params: {agent: string; dir: string; sessionId?: string},
): Promise<{sessionId: string; pid?: number; status: "new" | "reconnect" | "resumed"}> {
  const gw = await prisma.gateway.findUniqueOrThrow({
    where: {id: gatewayId},
    select: {id: true, baseUrl: true},
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
  return {sessionId: body.sessionId, pid: body.pid, status: body.status};
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
    const res = await authedFetch(gw, "/manifest", { method: "GET", timeoutMs });
    if (!res.ok) return null;
    const etag = res.headers.get("etag") ?? "";
    const manifest = Manifest.parse(await res.json());
    return { manifest, etag };
  } catch {
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
export async function verifyGateway(
  baseUrl: string,
  securityKey: string,
): Promise<{ gatewayId: string | null; hostname: string | null; platform: string | null } | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/verify`, {
      headers: { authorization: `Bearer ${securityKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      gatewayId?: string | null;
      hostname?: string | null;
      platform?: string | null;
    };
    if (!body.ok) return null;
    return {
      gatewayId: body.gatewayId ?? null,
      hostname: body.hostname ?? null,
      platform: body.platform ?? null,
    };
  } catch {
    return null;
  }
}
