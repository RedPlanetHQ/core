import { prisma } from "~/db.server";
import { ciphertext } from "./secrets.server";
import { verifyGateway } from "./transport.server";

export interface RegisterGatewayInput {
  /** Optional friendly override. If omitted, derived from manifest.gateway.name
   *  (or the machine hostname as a fallback). */
  name?: string;
  description?: string;
  baseUrl: string;
  securityKey: string;
  workspaceId: string;
  userId: string;
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchManifestWithRawKey(baseUrl: string, securityKey: string) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/manifest`, {
      headers: { authorization: `Bearer ${securityKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      gateway?: { name?: string; hostname?: string; platform?: string };
      tools?: unknown[];
      etag?: string;
    };
  } catch {
    return null;
  }
}

export interface RegisterGatewayResult {
  ok: true;
  gatewayId: string;
}

export interface RegisterGatewayError {
  ok: false;
  error: string;
}

/**
 * Register a user-hosted gateway with the CORE backend. The caller (the API
 * route) hands in the raw `securityKey` straight from the user's CLI output.
 *
 * Flow:
 *  1. Hit the gateway's `GET /verify` to prove it's reachable and that our
 *     key matches its stored hash.
 *  2. Persist the Gateway row with the encrypted securityKey. The manifest
 *     is NOT cached — agent/UI code live-fetches it on demand.
 *
 * Returns `{ok:true, gatewayId}` on success or `{ok:false, error}` on any
 * failure — no half-persisted state on failure (step 1 runs before any DB
 * write).
 */
export async function registerGateway(
  input: RegisterGatewayInput,
): Promise<RegisterGatewayResult | RegisterGatewayError> {
  // 1. Reachability + key check
  const probe = await verifyGateway(input.baseUrl, input.securityKey);
  if (!probe.ok) {
    return { ok: false, error: probe.reason };
  }

  // 2. Pull the manifest once (with the raw key — the DB row doesn't exist
  // yet, so `fetchManifest(gatewayId)` can't decrypt anything). We use it
  // only to derive the display name; the manifest itself is not cached —
  // agent / UI code live-fetches it on demand.
  const rawManifest = await fetchManifestWithRawKey(
    input.baseUrl,
    input.securityKey,
  );

  // Derive name: explicit override > manifest.gateway.name > /verify hostname
  // > URL hostname slug.
  const name =
    input.name?.trim() ||
    rawManifest?.gateway?.name ||
    probe.hostname ||
    hostnameFromUrl(input.baseUrl) ||
    "gateway";

  // Re-registering the same baseUrl in the same workspace just rotates the
  // key and refreshes state — it is not a collision.
  const existing = await prisma.gateway.findFirst({
    where: { workspaceId: input.workspaceId, baseUrl: input.baseUrl },
    select: { id: true, name: true },
  });

  if (!existing) {
    const nameCollision = await prisma.gateway.findFirst({
      where: { workspaceId: input.workspaceId, name },
      select: { id: true },
    });
    if (nameCollision) {
      return {
        ok: false,
        error: `A gateway named "${name}" is already registered in this workspace.`,
      };
    }
  }

  const gateway = existing
    ? await prisma.gateway.update({
        where: { id: existing.id },
        data: {
          description: input.description,
          hostname: probe.hostname ?? undefined,
          platform: probe.platform ?? undefined,
          encryptedSecurityKey: ciphertext(input.securityKey),
          status: "CONNECTED",
          connectedAt: new Date(),
          lastSeenAt: new Date(),
          lastHealthError: null,
        },
      })
    : await prisma.gateway.create({
        data: {
          name,
          description: input.description,
          baseUrl: input.baseUrl,
          hostname: probe.hostname ?? undefined,
          platform: probe.platform ?? undefined,
          encryptedSecurityKey: ciphertext(input.securityKey),
          status: "CONNECTED",
          connectedAt: new Date(),
          lastSeenAt: new Date(),
          workspace: { connect: { id: input.workspaceId } },
          user: { connect: { id: input.userId } },
        },
      });

  return { ok: true, gatewayId: gateway.id };
}
