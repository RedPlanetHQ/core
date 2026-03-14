import { json } from "@remix-run/node";
import { z } from "zod";
import { generateText } from "ai";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getModel, getModelForTask } from "~/lib/model.server";
import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";
import { SKILL_GENERATOR_SYSTEM_PROMPT } from "~/utils/skill-generator-prompt";

const GenerateSkillBody = z.object({
  userIntent: z.string().min(1, "User intent is required"),
  connectedTools: z.array(z.string()).optional(),
});

interface SkillDraft {
  title: string;
  shortDescription: string;
  description: string;
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseSkillDraft(text: string): SkillDraft | null {
  try {
    const cleaned = stripCodeFences(text);
    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.title === "string" &&
      typeof parsed.shortDescription === "string" &&
      typeof parsed.description === "string"
    ) {
      return {
        title: parsed.title,
        shortDescription: parsed.shortDescription,
        description: parsed.description,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function callLLM(userMessage: string): Promise<string> {
  const model = getModelForTask("low");
  const modelInstance = getModel(model);

  if (!modelInstance) {
    throw new Error("No model available");
  }

  const { text } = await generateText({
    model: modelInstance,
    messages: [
      { role: "system", content: SKILL_GENERATOR_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  return text;
}

const { action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    method: "POST",
  },
  async ({ authentication, request }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    const body = await request.json();
    const validatedData = GenerateSkillBody.parse(body);

    // Fetch user's connected integrations from DB for context
    let connectedTools: string[] = validatedData.connectedTools ?? [];

    if (connectedTools.length === 0) {
      const accounts = await getConnectedIntegrationAccounts(
        authentication.userId,
        authentication.workspaceId,
      );
      connectedTools = accounts.map((a) => a.integrationDefinition.name);
    }

    const toolsContext =
      connectedTools.length > 0
        ? `\n\nUser's connected tools: ${connectedTools.join(", ")}`
        : "";

    const userMessage = `User intent: ${validatedData.userIntent}${toolsContext}`;

    // First attempt
    let rawText = await callLLM(userMessage);
    let draft = parseSkillDraft(rawText);

    // Retry once if parsing failed
    if (!draft) {
      rawText = await callLLM(userMessage);
      draft = parseSkillDraft(rawText);
    }

    if (!draft) {
      return json(
        { error: "Failed to generate a valid skill draft. Please try again." },
        { status: 422 },
      );
    }

    return json(draft);
  },
);

export { action };
