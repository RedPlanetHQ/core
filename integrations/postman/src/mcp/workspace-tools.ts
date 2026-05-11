import { z } from "zod";
import { postmanGet } from "../utils";

export const ListWorkspacesSchema = z.object({});

export const GetWorkspaceSchema = z.object({
  workspaceId: z.string().describe("Postman workspace id (uuid)."),
});

export async function listWorkspaces(_args: z.infer<typeof ListWorkspacesSchema>, apiKey: string) {
  const res = await postmanGet<{ workspaces: any[] }>("/workspaces", apiKey);
  const list = res.workspaces ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No workspaces found." }] };
  }
  const text =
    `Found ${list.length} workspace(s):\n\n` +
    list
      .map(
        (w) => `- ${w.name} [${w.type ?? "workspace"}, ${w.visibility ?? "unknown"}]\n  id: ${w.id}`
      )
      .join("\n");
  return { content: [{ type: "text", text }] };
}

export async function getWorkspace(args: z.infer<typeof GetWorkspaceSchema>, apiKey: string) {
  const res = await postmanGet<{ workspace: any }>(`/workspaces/${args.workspaceId}`, apiKey);
  const w = res.workspace;
  const lines = [
    `Workspace: ${w.name}`,
    `  id:          ${w.id}`,
    `  type:        ${w.type}`,
    `  visibility:  ${w.visibility ?? "unknown"}`,
    `  description: ${w.description ?? "(none)"}`,
    `  collections: ${(w.collections ?? []).length}`,
    `  environments: ${(w.environments ?? []).length}`,
    `  monitors:    ${(w.monitors ?? []).length}`,
    `  mocks:       ${(w.mocks ?? []).length}`,
    `  apis:        ${(w.apis ?? []).length}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
