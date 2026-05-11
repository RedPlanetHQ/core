import { postmanGet } from "./utils";
import {
  PostmanActivity,
  workspaceActivity,
  collectionActivity,
  environmentActivity,
  apiActivity,
  monitorRunActivity,
} from "./create-activity";

interface SyncState {
  lastSyncTime?: string;
  lastWorkspaceSync?: string;
  lastCollectionSync?: string;
  lastEnvironmentSync?: string;
  lastApiSync?: string;
  lastMonitorSync?: string;
  seenMonitorRunIds?: Record<string, string>;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function handleSchedule(config: Record<string, any>, state: SyncState = {}) {
  const apiKey = config?.api_key;
  if (!apiKey) {
    console.error("[postman] no api_key in config — skipping sync");
    return [];
  }

  const since = state.lastSyncTime ?? new Date(Date.now() - ONE_DAY_MS).toISOString();
  const now = new Date().toISOString();
  const messages: PostmanActivity[] = [];
  const seenMonitorRunIds = { ...(state.seenMonitorRunIds ?? {}) };

  for (const [name, fn] of [
    ["workspaces", () => syncWorkspaces(apiKey, since)],
    ["collections", () => syncCollections(apiKey, since)],
    ["environments", () => syncEnvironments(apiKey, since)],
    ["apis", () => syncApis(apiKey, since)],
    ["monitor-runs", () => syncMonitorRuns(apiKey, seenMonitorRunIds)],
  ] as const) {
    try {
      messages.push(...(await fn()));
    } catch (e: any) {
      console.error(`[postman] ${name} sync failed:`, e.message);
    }
  }

  const newState: SyncState = {
    ...state,
    lastSyncTime: now,
    lastWorkspaceSync: now,
    lastCollectionSync: now,
    lastEnvironmentSync: now,
    lastApiSync: now,
    lastMonitorSync: now,
    seenMonitorRunIds,
  };

  return [...messages, { type: "state", data: newState }];
}

async function syncWorkspaces(apiKey: string, since: string): Promise<PostmanActivity[]> {
  // The list endpoint omits timestamps, so we hit the detail endpoint for each
  // workspace to read updatedAt. Capped at 50 to stay polite under rate limits.
  const res = await postmanGet<{ workspaces: any[] }>("/workspaces", apiKey);
  const workspaces = res.workspaces ?? [];
  const out: PostmanActivity[] = [];

  for (const ws of workspaces) {
    if (out.length >= 50) break;
    try {
      const detail = await postmanGet<{ workspace: any }>(`/workspaces/${ws.id}`, apiKey);
      const w = detail.workspace ?? ws;
      const updatedAt = w.updatedAt ?? w.createdAt;
      if (updatedAt && new Date(updatedAt) > new Date(since)) {
        const verb = w.createdAt && new Date(w.createdAt) > new Date(since) ? "created" : "updated";
        out.push(workspaceActivity(w, verb));
      }
    } catch (e: any) {
      console.error(`[postman] workspace ${ws.id} detail failed:`, e.message);
    }
  }
  return out;
}

async function syncCollections(apiKey: string, since: string): Promise<PostmanActivity[]> {
  const res = await postmanGet<{ collections: any[] }>("/collections", apiKey);
  const out: PostmanActivity[] = [];
  for (const c of res.collections ?? []) {
    const updatedAt = c.updatedAt ?? c.createdAt;
    if (!updatedAt || new Date(updatedAt) > new Date(since)) {
      const verb = c.createdAt && new Date(c.createdAt) > new Date(since) ? "created" : "updated";
      out.push(collectionActivity(c, verb));
    }
    if (out.length >= 100) break;
  }
  return out;
}

async function syncEnvironments(apiKey: string, since: string): Promise<PostmanActivity[]> {
  const res = await postmanGet<{ environments: any[] }>("/environments", apiKey);
  const out: PostmanActivity[] = [];
  for (const e of res.environments ?? []) {
    const updatedAt = e.updatedAt ?? e.createdAt;
    if (!updatedAt || new Date(updatedAt) > new Date(since)) {
      const verb = e.createdAt && new Date(e.createdAt) > new Date(since) ? "created" : "updated";
      out.push(environmentActivity(e, verb));
    }
    if (out.length >= 50) break;
  }
  return out;
}

async function syncApis(apiKey: string, since: string): Promise<PostmanActivity[]> {
  const out: PostmanActivity[] = [];
  let apis: any[] = [];
  try {
    const res = await postmanGet<{ apis: any[] }>("/apis", apiKey);
    apis = res.apis ?? [];
  } catch (e: any) {
    console.error("[postman] /apis without workspace failed (paid plan only?):", e.message);
    return [];
  }
  for (const api of apis) {
    const updatedAt = api.updatedAt;
    if (updatedAt && new Date(updatedAt) > new Date(since)) {
      const verb =
        api.createdAt && new Date(api.createdAt) > new Date(since) ? "created" : "updated";
      out.push(apiActivity(api, verb));
    }
    if (out.length >= 50) break;
  }
  return out;
}

async function syncMonitorRuns(
  apiKey: string,
  seenMonitorRunIds: Record<string, string>
): Promise<PostmanActivity[]> {
  const list = await postmanGet<{ monitors: any[] }>("/monitors", apiKey);
  const out: PostmanActivity[] = [];

  for (const m of list.monitors ?? []) {
    try {
      const runsRes = await postmanGet<{ runs: any[] }>(`/monitors/${m.uid ?? m.id}/runs`, apiKey);
      const runs = runsRes.runs ?? [];
      if (runs.length === 0) continue;

      const lastSeen = seenMonitorRunIds[m.uid ?? m.id];
      for (const run of runs) {
        if (run.id === lastSeen) break;
        out.push(monitorRunActivity(m, run));
        if (out.length >= 100) break;
      }
      seenMonitorRunIds[m.uid ?? m.id] = runs[0].id;
    } catch (e: any) {
      console.error(`[postman] monitor ${m.id} runs failed:`, e.message);
    }
    if (out.length >= 100) break;
  }
  return out;
}
