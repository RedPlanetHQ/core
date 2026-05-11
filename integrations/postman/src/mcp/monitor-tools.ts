import { z } from "zod";
import { postmanGet } from "../utils";

export const ListMonitorsSchema = z.object({
  workspaceId: z.string().optional().describe("Filter by workspace id."),
});

export const GetMonitorSchema = z.object({
  monitorUid: z.string().describe("Postman monitor uid."),
});

export async function listMonitors(args: z.infer<typeof ListMonitorsSchema>, apiKey: string) {
  const params = args.workspaceId ? { workspace: args.workspaceId } : undefined;
  const res = await postmanGet<{ monitors: any[] }>("/monitors", apiKey, params);
  const list = res.monitors ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No monitors found." }] };
  }
  const text =
    `Found ${list.length} monitor(s):\n\n` +
    list
      .map((m) => `- ${m.name}\n  uid: ${m.uid}\n  collection: ${m.collectionUid ?? "?"}`)
      .join("\n\n");
  return { content: [{ type: "text", text }] };
}

export async function getMonitor(args: z.infer<typeof GetMonitorSchema>, apiKey: string) {
  const res = await postmanGet<{ monitor: any }>(`/monitors/${args.monitorUid}`, apiKey);
  const m = res.monitor;
  const lines = [
    `Monitor: ${m.name}`,
    `  uid:        ${m.uid}`,
    `  collection: ${m.collectionUid ?? "?"}`,
    `  environment: ${m.environmentUid ?? "(none)"}`,
    `  schedule:   ${m.schedule?.cron ?? "(unknown)"} (${m.schedule?.timezone ?? "UTC"})`,
    `  lastRun:    ${m.lastRun?.startedAt ?? "(never)"} → ${m.lastRun?.status ?? "?"}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
