import { createAgent, getModelForTask } from "~/lib/model.server";

export async function generateButlerName(excluded: string[] = []): Promise<string> {
  const excludedLower = excluded.map((n) => n.toLowerCase());
  const exclusion = excludedLower.length > 0
    ? ` Do not use any of these names: ${excluded.join(", ")}.`
    : "";

  const agent = createAgent(getModelForTask("low"));
  const result = await agent.generate(
    `Generate a single classic English butler first name that sounds distinguished and old-fashioned.${exclusion} Reply with only the name, nothing else.`,
    { temperature: 1 },
  );

  return result.text.trim().split(/\s+/)[0] ?? "James";
}
