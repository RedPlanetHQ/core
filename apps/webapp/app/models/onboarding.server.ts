import { createAgent, resolveModelString } from "~/lib/model.server";

export async function generateButlerName(excluded: string[] = []): Promise<string> {
  const excludedLower = excluded.map((n) => n.toLowerCase());
  const exclusion = excludedLower.length > 0
    ? ` Do not use any of these names: ${excluded.join(", ")}.`
    : "";

  const agent = createAgent(await resolveModelString("chat", "low"));
  const result = await agent.generate(
    `Generate a single classic English butler first name that sounds distinguished and old-fashioned.${exclusion} Reply with only the name, nothing else.`,
    // `temperature` was removed from Mastra Agent's options in the recent
    // upgrade; provider-specific overrides now go through `modelSettings`.
    { modelSettings: { temperature: 1 } as Record<string, unknown> } as any,
  );

  return result.text.trim().split(/\s+/)[0] ?? "James";
}
