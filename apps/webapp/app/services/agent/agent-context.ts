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

interface BuildAgentContextParams {
  userId: string;
  workspaceId: string;
  source: ChannelType;
  /** UI-format messages: { parts, role, id }[] */
  finalMessages: any[];
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
}: BuildAgentContextParams): Promise<AgentContext> {
  // Load context in parallel
  const [user, persona, connectedIntegrations] = await Promise.all([
    getUserById(userId),
    getPersonaDocumentForUser(workspaceId),
    IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId),
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
