/**
 * Short-lived signed token for read-only public file access on a
 * connected gateway. Used to hand a publicly-fetchable URL to viewers
 * that can't carry session cookies — Microsoft Office Online Viewer
 * (via @cyntler/react-doc-viewer for PPTX/DOCX/XLSX), Google Docs
 * Viewer, etc.
 *
 * Stateless HMAC-SHA256 over SESSION_SECRET. Mirrors the same pattern
 * as `services/collab-token.server.ts` so the surface area is
 * consistent. No DB row — verification re-derives the signature.
 *
 * Token shape: `<workspaceId>:<gatewayId>:<base64url(path)>:<expMs>:<sig>`
 * encoded as a single base64url string. Workspace is captured for
 * audit and to scope verification (a token issued for workspace A
 * can't be reinterpreted against workspace B).
 *
 * TTL is intentionally short (5 minutes) — the URL is meant to be
 * fetched a handful of times by an external viewer during a single
 * preview session, not stored or shared.
 */

import { createHmac } from "crypto";
import { env } from "~/env.server";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface FileTokenPayload {
  workspaceId: string;
  gatewayId: string;
  path: string;
}

export function generateFileToken(payload: FileTokenPayload): {
  token: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + TTL_MS;
  const pathB64 = Buffer.from(payload.path, "utf8").toString("base64url");
  const body = `${payload.workspaceId}:${payload.gatewayId}:${pathB64}:${expiresAt}`;
  const sig = createHmac("sha256", env.SESSION_SECRET).update(body).digest("hex");
  const token = Buffer.from(`${body}:${sig}`).toString("base64url");
  return { token, expiresAt };
}

export function verifyFileToken(
  token: string,
): (FileTokenPayload & { expiresAt: number }) | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 5) return null;
    const [workspaceId, gatewayId, pathB64, expStr, sig] = parts;
    const body = `${workspaceId}:${gatewayId}:${pathB64}:${expStr}`;
    const expected = createHmac("sha256", env.SESSION_SECRET)
      .update(body)
      .digest("hex");
    // Constant-time-ish compare; lengths are equal in the happy path.
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i += 1) {
      diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff !== 0) return null;
    const expiresAt = parseInt(expStr, 10);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
    const decodedPath = Buffer.from(pathB64, "base64url").toString("utf8");
    return { workspaceId, gatewayId, path: decodedPath, expiresAt };
  } catch {
    return null;
  }
}
