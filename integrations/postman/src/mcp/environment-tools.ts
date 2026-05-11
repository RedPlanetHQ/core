import { z } from "zod";

import { postmanGet } from "../utils";

export const ListEnvironmentsSchema = z.object({
  workspaceId: z.string().optional().describe("Filter by Postman workspace id."),
});

export const GetEnvironmentSchema = z.object({
  environmentUid: z.string().describe("Postman environment uid."),
});

export async function listEnvironments(
  args: z.infer<typeof ListEnvironmentsSchema>,
  apiKey: string
) {
  const params = args.workspaceId ? { workspace: args.workspaceId } : undefined;
  const res = await postmanGet<{ environments: any[] }>("/environments", apiKey, params);
  const list = res.environments ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No environments found." }] };
  }
  const text =
    `Found ${list.length} environment(s):\n\n` +
    list.map((e) => `- ${e.name}\n  uid: ${e.uid}`).join("\n");
  return { content: [{ type: "text", text }] };
}

export async function getEnvironment(args: z.infer<typeof GetEnvironmentSchema>, apiKey: string) {
  const res = await postmanGet<{ environment: any }>(
    `/environments/${args.environmentUid}`,
    apiKey
  );
  const e = res.environment;
  const vars = (e.values ?? [])
    .map(
      (v: any) =>
        `  - ${v.key} = ${v.type === "secret" ? "***" : v.value} ` +
        `[${v.type ?? "default"}, ${v.enabled === false ? "disabled" : "enabled"}]`
    )
    .join("\n");
  const text = [
    `Environment: ${e.name}`,
    `  uid: ${e.id ?? args.environmentUid}`,
    `Variables:`,
    vars || "  (none)",
  ].join("\n");
  return { content: [{ type: "text", text }] };
}
