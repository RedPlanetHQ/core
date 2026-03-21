import { generateText } from "ai";
import { getModel, getModelForTask } from "~/lib/model.server";

export async function generateButlerName(excluded: string[] = []): Promise<string> {
  const excludedLower = excluded.map((n) => n.toLowerCase());
  const exclusion = excludedLower.length > 0
    ? ` Do not use any of these names: ${excluded.join(", ")}.`
    : "";

  const { text } = await generateText({
    model: getModel(getModelForTask("low")),
    temperature: 1,
    prompt:
      `Generate a single classic English butler first name that sounds distinguished and old-fashioned.${exclusion} Reply with only the name, nothing else.`,
  });

  return text.trim().split(/\s+/)[0] ?? "James";
}
