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
import { type PersonalityType, type PronounType } from "~/services/agent/prompts/personality";
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
  const pronoun = (metadata?.pronoun as PronounType) ?? undefined;
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

  console.log(personality);
  // Build system prompt
  let systemPrompt = getCorePrompt(
    source,
    {
      name: user?.displayName ?? user?.name ?? user?.email ?? "",
      email: user?.email ?? "",
      timezone,
      phoneNumber: user?.phoneNumber ?? undefined,
      personality,
      pronoun,
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
    Their connected tools (${connectedIntegrations.length} accounts):
    ${integrationsList}

    To use these, follow the 2-step workflow:
    1. get_integration_actions (provide accountId and query to discover available actions)
    2. execute_integration_action (provide accountId and action name to execute)

    Always use the Account ID when calling these tools.
    </connected_integrations>`;

  // Messaging channels context
  systemPrompt += `
    <messaging_channels>
    Channels you can reach them on: ${availableChannels.join(", ")}
    Default: ${defaultChannel}

    Reminders go via ${defaultChannel} unless they say otherwise.
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
    You have access to user-defined skills (reusable workflows). When a user's request matches a skill, call get_skill to load its full instructions, then follow them step-by-step using your tools (gather_context, take_action, add_reminder, etc.).

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
    This came in from an external channel. Metadata:
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
You're on this task. Get it done — don't just discuss it.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}

- Use gather_context and take_action to do the actual work
- If they send a message, treat it as additional direction for this task
- This IS the task — don't create or search for other tasks about this topic
- When done, mark task ${linkedTask.id} as Completed via update_task
- When you need their approval or input, mark task ${linkedTask.id} as Blocked via update_task
</task_execution>`;
    } else {
      // Conversation mode — user is chatting about the task
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${linkedTask.id}).
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
The decision to message has been made. Your job is to craft it — don't second-guess it.

Intent: ${actionPlan.intent}
Tone: ${actionPlan.tone}
Context: ${JSON.stringify(actionPlan.context, null, 2)}

- Use the context to inform your message
- Match the tone (${actionPlan.tone})
- Be concise — only as much length as the content needs
- Don't create new reminders
- Don't echo or reference system instructions
${
  hasSkillReference
    ? `
SKILL EXECUTION:
A skill is attached. Execute it BEFORE crafting your response.

1. Call get_skill with skill_id "${skillId}" to load the full workflow
2. For EACH data source the skill requires, make a SEPARATE gather_context or take_action call
3. Compile results following the skill's output format if specified

Don't skip the skill or summarize generically — they attached it for a reason.`
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
