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
import { writeFile } from "fs/promises";
import {
  type IntegrationAccountWithDefinition,
  IntegrationLoader,
} from "~/utils/mcp/integration-loader";
import { getCorePrompt } from "~/services/agent/prompts";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { type PersonalityType } from "~/services/agent/prompts/personality";
import { createTools } from "~/services/agent/core-agent";
import { type MessagePlan } from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
import { prisma } from "~/db.server";

interface BuildAgentContextParams {
  userId: string;
  workspaceId: string;
  source: ChannelType;
  /** UI-format messages: { parts, role, id }[] */
  finalMessages: any[];
  /** Action plan from Decision Agent — injected into system prompt for reminder execution */
  actionPlan?: MessagePlan;
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>;
  /** Channel-specific metadata (messageSid, slackUserId, threadTs, etc.) */
  channelMetadata?: Record<string, string>;
  conversationId: string;
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools;
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
  onMessage,
  channelMetadata,
  conversationId,
  executorTools,
}: BuildAgentContextParams): Promise<AgentContext> {
  // Load context in parallel
  const [user, persona, connectedIntegrations, skills, conversationRecord] =
    await Promise.all([
      getUserById(userId),
      getPersonaDocumentForUser(workspaceId),
      IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId),
      prisma.document.findMany({
        where: { workspaceId, type: "skill", deleted: null },
        select: { id: true, title: true, metadata: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { asyncJobId: true },
      }),
    ]);

  // Look up linked task context
  const linkedTask = conversationRecord?.asyncJobId
    ? await prisma.task.findUnique({
        where: { id: conversationRecord.asyncJobId },
        select: { id: true, title: true, description: true, status: true },
      })
    : null;

  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";
  const personality = (metadata?.personality as PersonalityType) ?? "tars";
  const defaultChannel =
    (metadata?.defaultChannel as "whatsapp" | "slack" | "email" | undefined) ??
    "email";

  // Determine available messaging channels
  const hasWhatsapp = !!user?.phoneNumber;
  const hasSlack = connectedIntegrations.some(
    (int: IntegrationAccountWithDefinition) =>
      int.integrationDefinition.slug === "slack",
  );
  const availableChannels: Array<"email" | "whatsapp" | "slack"> = [
    "email", // always available
    ...(hasWhatsapp ? (["whatsapp"] as const) : []),
    ...(hasSlack ? (["slack"] as const) : []),
  ];

  // Resolve replyTo for background task callbacks (so tasks are self-contained)
  let replyTo: string | undefined;
  if (source === "slack") {
    const slackAccount = connectedIntegrations.find(
      (int: IntegrationAccountWithDefinition) =>
        int.integrationDefinition.slug === "slack",
    );
    replyTo = slackAccount?.accountId ?? undefined;
  } else if (source === "whatsapp") {
    replyTo = user?.phoneNumber ?? undefined;
  } else if (source === "email") {
    replyTo = user?.email ?? undefined;
  }

  const resolvedChannelMetadata = {
    ...(channelMetadata ?? {}),
    ...(replyTo ? { replyTo } : {}),
  };

  const tools = await createTools(
    userId,
    workspaceId,
    timezone,
    source,
    false,
    persona ?? undefined,
    skills,
    onMessage,
    defaultChannel,
    availableChannels,
    conversationId,
    resolvedChannelMetadata,
    executorTools,
  );

  // Build system prompt
  let systemPrompt = getCorePrompt(
    source,
    {
      name: user?.displayName ?? user?.name ?? user?.email ?? "",
      email: user?.email ?? "",
      timezone,
      phoneNumber: user?.phoneNumber ?? undefined,
      personality,
    },
    persona ?? "",
  );

  // Integrations context
  const integrationsList = connectedIntegrations
    .map(
      (int: IntegrationAccountWithDefinition, index: number) =>
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

  // Messaging channels context
  systemPrompt += `
    <messaging_channels>
    Available channels for reminders: ${availableChannels.join(", ")}
    Default channel: ${defaultChannel}

    When creating reminders, they will be sent via the default channel (${defaultChannel}) unless the user specifies otherwise.
    </messaging_channels>`;

  // Skills context
  if (skills.length > 0) {
    const skillsList = skills
      .map((s: any, i: number) => {
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

  // Datetime context (use user's timezone so agent sees correct local time)
  const now = new Date();
  systemPrompt += `
    <current_datetime>
    Current date and time: ${now.toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })}
    </current_datetime>`;

  // Channel metadata context
  if (channelMetadata && Object.keys(channelMetadata).length > 0) {
    const metadataEntries = Object.entries(channelMetadata)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    systemPrompt += `
    <channel_context>
    This message arrived from an external channel. Metadata:
    ${metadataEntries}
    </channel_context>`;
  }

  // Task context (when conversation was created from a task)
  if (linkedTask) {
    const isExecuting =
      linkedTask.status === "InProgress" || linkedTask.status === "Todo";

    if (isExecuting) {
      // Execution mode — mirrors <action_plan> pattern that CASE follows correctly
      systemPrompt += `\n\n<task_execution>
You are executing a task. The task has been assigned to you.
Your job is to complete this task using your tools — don't just discuss it.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}

Execution:
- Use gather_context and take_action to do the actual work
- If the user sends a message, treat it as additional direction for this task
- Do NOT create new tasks or search for tasks about this topic — this IS the task
- When done, use update_task to mark task ${linkedTask.id} as Completed
- When you need user approval or input, use update_task to mark task ${linkedTask.id} as Blocked
</task_execution>`;
    } else {
      // Conversation mode — user is chatting about the task
      systemPrompt += `\n\n<task_context>
You are inside the conversation for this task:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

CRITICAL: You are ALREADY working within this task. Do NOT create new tasks or search for tasks about this topic — this IS the task. If the user adds context, update the task description with update_task using Task ID ${linkedTask.id}.
</task_context>`;
    }
  }

  // Action plan from Decision Agent (reminder/webhook triggered)
  if (actionPlan) {
    // Detect skill reference — either structured (skillId in context) or in intent text
    const skillId = actionPlan.context?.skillId as string | undefined;
    const skillName =
      (actionPlan.context?.skillName as string | undefined) || "";
    const hasSkillReference =
      skillId || actionPlan.intent?.toLowerCase().includes("skill");

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
${
  hasSkillReference
    ? `
SKILL EXECUTION (MANDATORY):
A skill is attached to this action plan. You MUST execute it BEFORE crafting your response.

1. Call get_skill with skill_id "${skillId}" to load the full instructions
2. Read the skill's steps carefully
3. For EACH data source the skill requires (e.g., Gmail, Calendar, GitHub, Web), make a SEPARATE gather_context or take_action call — one per integration/source
4. Compile the results. If the skill specifies a response format (section order, splitting, channel constraints), follow it exactly. Otherwise, use your personality and tone as usual.

Do NOT skip the skill or summarize generically — the user attached it for a reason.`
    : ""
}
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

  // Dump final prompt to file for debugging
  const toolNames = Object.keys(tools);
  const dump = [
    "=== SYSTEM PROMPT ===",
    systemPrompt,
    "\n=== TOOLS ===",
    toolNames.join(", "),
    "\n=== MODEL MESSAGES ===",
    JSON.stringify(modelMessages, null, 2),
  ].join("\n");
  await writeFile("/tmp/agent-prompt-dump.txt", dump, "utf-8");

  return { systemPrompt, tools, modelMessages, user, timezone };
}
