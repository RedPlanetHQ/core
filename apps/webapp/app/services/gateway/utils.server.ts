import { fetchManifest } from "./transport.server";
import type { Folder, FolderScope } from "@core/gateway-protocol";

/**
 * Live-fetch the gateway's registered folders from its `/manifest` endpoint.
 * Pass `scope` to filter to folders that include that scope (e.g. only
 * "coding"-scoped folders for the new-session dialog).
 *
 * We intentionally do NOT read the DB-cached manifest here — the user may
 * have added a folder on their machine since the last health poll. The
 * health poller updates the cache for background concerns; user-facing
 * UI always goes to the source of truth.
 */
export async function getGatewayFolders(
  gatewayId: string,
  scope?: FolderScope,
): Promise<Folder[]> {
  const m = await fetchManifest(gatewayId);
  if (!m) return [];
  const folders = m.manifest.folders ?? [];
  if (!scope) return folders;
  return folders.filter((f) => f.scopes.includes(scope));
}

/**
 * Live-fetch the gateway's configured coding agents (e.g. "claude-code").
 */
export async function getGatewayAgents(gatewayId: string): Promise<string[]> {
  const m = await fetchManifest(gatewayId);
  if (!m) return [];
  return m.manifest.agents ?? [];
}

/**
 * Live-fetch everything the UI typically needs in one roundtrip.
 */
export async function getGatewayInfo(
  gatewayId: string,
): Promise<{
  folders: Folder[];
  agents: string[];
  gateway: { id: string; name: string; hostname: string; platform: string };
  tools: Array<{ name: string; description: string }>;
} | null> {
  const m = await fetchManifest(gatewayId);
  if (!m) return null;
  const { manifest } = m;
  return {
    folders: manifest.folders ?? [],
    agents: manifest.agents ?? [],
    gateway: {
      id: manifest.gateway.id,
      name: manifest.gateway.name,
      hostname: manifest.gateway.hostname,
      platform: manifest.gateway.platform,
    },
    tools: (manifest.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
    })),
  };
}
