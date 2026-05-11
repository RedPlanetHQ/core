import { z } from "zod";
import { postmanGet } from "../utils";

export const ListApisSchema = z.object({
  workspaceId: z.string().optional().describe("Filter by workspace id."),
});

export const GetApiSchema = z.object({
  apiId: z.string().describe("Postman API id."),
});

export const ListApiVersionsSchema = z.object({
  apiId: z.string().describe("Postman API id whose versions to list."),
});

export async function listApis(args: z.infer<typeof ListApisSchema>, apiKey: string) {
  const params = args.workspaceId ? { workspace: args.workspaceId } : undefined;
  const res = await postmanGet<{ apis: any[] }>("/apis", apiKey, params);
  const list = res.apis ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No APIs found." }] };
  }
  const text =
    `Found ${list.length} API(s):\n\n` +
    list
      .map(
        (a) =>
          `- ${a.name}\n  id: ${a.id}\n  summary: ${a.summary ?? "(none)"}` +
          (a.updatedAt ? `\n  updated: ${a.updatedAt}` : "")
      )
      .join("\n\n");
  return { content: [{ type: "text", text }] };
}

export async function getApi(args: z.infer<typeof GetApiSchema>, apiKey: string) {
  const res = await postmanGet<{ api: any }>(`/apis/${args.apiId}`, apiKey);
  const a = res.api;
  const lines = [
    `  API:         ${a.name}`,
    `  id:          ${a.id}`,
    `  summary:     ${a.summary ?? "(none)"}`,
    `  description: ${a.description ?? "(none)"}`,
    `  created:     ${a.createdAt ?? "?"}`,
    `  updated:     ${a.updatedAt ?? "?"}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export async function listApiVersions(args: z.infer<typeof ListApiVersionsSchema>, apiKey: string) {
  const res = await postmanGet<{ versions: any[] }>(`/apis/${args.apiId}/versions`, apiKey);
  const list = res.versions ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: `No versions found for API ${args.apiId}.` }] };
  }
  const text =
    `Found ${list.length} version(s) for API ${args.apiId}:\n\n` +
    list
      .map(
        (v) =>
          `- ${v.name ?? v.id}\n  id: ${v.id}` +
          (v.summary ? `\n  summary: ${v.summary}` : "") +
          (v.updatedAt ? `\n  updated: ${v.updatedAt}` : "")
      )
      .join("\n\n");
  return { content: [{ type: "text", text }] };
}
