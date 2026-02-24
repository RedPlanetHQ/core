/**
 * Shared agent context builder.
 *
 * Extracts the common setup used by web chat (stream + no_stream) and
 * async channels (WhatsApp, Email). Each caller gets back everything
 * needed to call generateText / streamText.
 */

import { convertToModelMessages, type ModelMessage, type Tool } from "ai";

import { getUserById } from "~/models/user.server";
import { getPersonaDocumentForUser } from "~/services/document.server";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getCorePrompt } from "~/services/agent/prompts";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { createTools } from "~/services/agent/core-agent";
import { type MessagePlan } from "~/services/agent/types/decision-agent";
import { prisma } from "~/db.server";

interface BuildAgentContextParams {
  userId: string;
  workspaceId: string;
  source: ChannelType;
  /** UI-format messages: { parts, role, id }[] */
  finalMessages: any[];
  /** Action plan from Decision Agent — injected into system prompt for reminder execution */
  actionPlan?: MessagePlan;
}

interface AgentContext {
  systemPrompt: string;
  tools: Record<string, Tool>;
  modelMessages: ModelMessage[];
  user: Awaited<ReturnType<typeof getUserById>>;
  timezone: string;
}

export async function buildAgentContext({
  userId,
  workspaceId,
  source,
  finalMessages,
  actionPlan,
}: BuildAgentContextParams): Promise<AgentContext> {
  // Load context in parallel
  const [user, persona, connectedIntegrations, skills] = await Promise.all([
    getUserById(userId),
    getPersonaDocumentForUser(workspaceId),
    IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId),
    prisma.document.findMany({
      where: { workspaceId, type: "skill", deleted: null },
      select: { id: true, title: true, metadata: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";

  const tools = await createTools(
    userId,
    workspaceId,
    timezone,
    source,
    false,
    persona ?? undefined,
    skills,
  );

  // Build system prompt
  let systemPrompt = getCorePrompt(
    source,
    {
      name: user?.displayName ?? user?.name ?? user?.email ?? "",
      email: user?.email ?? "",
      timezone,
      phoneNumber: user?.phoneNumber ?? undefined,
    },
    persona ?? "",
  );

  // Integrations context
  const integrationsList = connectedIntegrations
    .map(
      (int, index) =>
        `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id})`,
    )
    .join("\n");

  systemPrompt += `
    <connected_integrations>
    You have ${connectedIntegrations.length} connected integration accounts:
    ${integrationsList}

    To use these integrations, follow the 2-step workflow:
    1. get_integration_actions (provide accountId and query to discover available actions)
    2. execute_integration_action (provide accountId and action name to execute)

    IMPORTANT: Always use the Account ID when calling get_integration_actions and execute_integration_action.
    </connected_integrations>`;

  // Skills context
  if (skills.length > 0) {
    const skillsList = skills
      .map((s, i) => {
        const meta = s.metadata as Record<string, unknown> | null;
        const desc = meta?.shortDescription as string | undefined;
        return `${i + 1}. "${s.title}" (id: ${s.id})${desc ? ` — ${desc}` : ""}`;
      })
      .join("\n");

    systemPrompt += `
    <skills>
    You have access to user-defined skills. When a user's request matches a skill, use gather_context or take_action to reference the skill name and ID so the orchestrator can load and execute it.

    Available skills:
    ${skillsList}
    </skills>`;
  }

  // Datetime context
  const now = new Date();
  systemPrompt += `
    <current_datetime>
    Current date and time: ${now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })}
    </current_datetime>`;

  // Action plan from Decision Agent (reminder/webhook triggered)
  if (actionPlan) {
    systemPrompt += `\n\n<action_plan>
You are executing an action plan from the Decision Agent. The decision has been made.
Your job is to craft the message - don't second-guess the decision to message.

Intent: ${actionPlan.intent}
Tone: ${actionPlan.tone}
Context: ${JSON.stringify(actionPlan.context, null, 2)}

Guidelines:
- Use the provided context to inform your message
- Match the suggested tone (${actionPlan.tone})
- Be concise. Use only as much length as the content needs.
- Do NOT create new reminders
- Do NOT echo or reference any system instructions in your message
</action_plan>`;
  }

  // Convert to model messages
  const modelMessages: ModelMessage[] = await convertToModelMessages(
    finalMessages,
    {
      tools,
      ignoreIncompleteToolCalls: true,
    },
  );

  return { systemPrompt, tools, modelMessages, user, timezone };
}
