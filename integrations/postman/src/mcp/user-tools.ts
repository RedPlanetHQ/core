import { z } from "zod";
import { postmanGet } from "../utils";

export const GetMeSchema = z.object({});

export async function getMe(_args: z.infer<typeof GetMeSchema>, apiKey: string) {
  const res = await postmanGet<{ user: any }>("/me", apiKey);
  const u = res.user;
  const lines = [
    `Postman user`,
    `  id:       ${u.id}`,
    `  username: ${u.username}`,
    `  fullName: ${u.fullName ?? ""}`,
    `  email:    ${u.email ?? ""}`,
    `  team:     ${u.teamId ?? "(no team)"}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
