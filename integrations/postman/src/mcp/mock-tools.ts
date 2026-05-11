import { z } from "zod";

import { postmanGet } from "../utils";

export const ListMocksSchema = z.object({
  workspaceId: z.string().optional().describe("Filter by workspace id."),
});

export const GetMockSchema = z.object({
  mockUid: z.string().describe("Postman mock server uid."),
});

export async function listMocks(args: z.infer<typeof ListMocksSchema>, apiKey: string) {
  const params = args.workspaceId ? { workspace: args.workspaceId } : undefined;
  const res = await postmanGet<{ mocks: any[] }>("/mocks", apiKey, params);
  const list = res.mocks ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No mock servers found." }] };
  }
  const text =
    `Found ${list.length} mock server(s):\n\n` +
    list
      .map(
        (m) =>
          `- ${m.name}\n  uid: ${m.uid}\n  url: ${m.mockUrl ?? "?"}` +
          (m.collection ? `\n  collection: ${m.collection}` : "")
      )
      .join("\n\n");
  return { content: [{ type: "text", text }] };
}

export async function getMock(args: z.infer<typeof GetMockSchema>, apiKey: string) {
  const res = await postmanGet<{ mock: any }>(`/mocks/${args.mockUid}`, apiKey);
  const m = res.mock;
  const lines = [
    `Mock server: ${m.name}`,
    `  uid:        ${m.uid}`,
    `  url:        ${m.mockUrl ?? "?"}`,
    `  collection: ${m.collection ?? "?"}`,
    `  environment: ${m.environment ?? "(none)"}`,
    `  private:    ${m.private ? "yes" : "no"}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
