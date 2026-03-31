import { createHmac } from "crypto";
import { env } from "~/env.server";

const TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateCollabToken(workspaceId: string, userId: string): string {
  const ts = Date.now().toString();
  const payload = `${workspaceId}:${userId}:${ts}`;
  const sig = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyCollabToken(token: string): { workspaceId: string; userId: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const idx = decoded.lastIndexOf(":");
    const sig = decoded.slice(idx + 1);
    const payload = decoded.slice(0, idx);
    const parts = payload.split(":");
    if (parts.length !== 3) return null;
    const [workspaceId, userId, ts] = parts;
    if (Date.now() - parseInt(ts) > TTL_MS) return null;
    const expected = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
    if (sig !== expected) return null;
    return { workspaceId, userId };
  } catch {
    return null;
  }
}
