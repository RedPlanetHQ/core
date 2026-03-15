import { z } from "zod";
import { streamText, type LanguageModel } from "ai";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getModel, getModelForTask } from "~/lib/model.server";
import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";
import { SKILL_GENERATOR_SYSTEM_PROMPT } from "~/utils/skill-generator-prompt";

const GenerateSkillBody = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  existingDescription: z.string().optional(),
  connectedTools: z.array(z.string()).optional(),
});

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

    const existingContext = validatedData.existingDescription
      ? `\n\nExisting description to update:\n${validatedData.existingDescription}`
      : "";

    const userMessage = `User intent: ${validatedData.prompt}${toolsContext}${existingContext}`;

    const model = getModelForTask("low");
    const modelInstance = getModel(model);

    if (!modelInstance) {
      throw new Response("No model available", { status: 503 });
    }

    const result = streamText({
      model: modelInstance as LanguageModel,
      messages: [
        { role: "system", content: SKILL_GENERATOR_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    return result.toTextStreamResponse();
  },
);

export { action };
