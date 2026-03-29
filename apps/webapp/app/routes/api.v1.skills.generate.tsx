import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { createAgent, resolveModelString } from "~/lib/model.server";
import { streamToUIResponse } from "~/services/agent/mastra-stream.server";
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

    const agent = createAgent(
      await resolveModelString("chat", "low"),
      SKILL_GENERATOR_SYSTEM_PROMPT,
    );
    const result = await agent.stream([{ role: "user", content: userMessage }]);
    return streamToUIResponse(result);
  },
);

export { action };
