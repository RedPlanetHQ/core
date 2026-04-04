/**
 * Shared agent context builder.
 *
 * Extracts the common setup used by web chat (stream + no_stream) and
 * async channels (WhatsApp, Email). Each caller gets back everything
 * needed to call Mastra Agent's stream() / generate(), plus the
 * orchestrator subagent and gateway sub-subagents.
 */

import { type Tool } from "ai";
import { type Agent, convertMessages } from "@mastra/core/agent";

import { getUserById } from "~/models/user.server";
import { getPersonaDocumentForUser } from "~/services/document.server";
import { writeFile } from "fs/promises";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getCorePrompt } from "~/services/agent/prompts";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { type PronounType } from "~/services/agent/prompts/personality";
import { getCustomPersonalities } from "~/models/personality.server";
import {
  createCoreTools,
  createCoreAgents,
} from "~/services/agent/agents/core";
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import { prisma } from "~/db.server";
import { getWorkspaceChannelContext } from "~/services/channel.server";
import { type MessageListInput } from "@mastra/core/agent/message-list";
import { type ModelConfig } from "~/services/llm-provider.server";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";
import { getCommentTools } from "~/services/agent/tools/comment-tools";

interface BuildAgentContextParams {
  userId: string;
  workspaceId: string;
  source: ChannelType;
  /** UI-format messages: { parts, role, id }[] */
  finalMessages: any[];
  /** Trigger context — when present, enables the think tool for decision-making */
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    reminderText: string;
    userPersona?: string;
  };
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>;
  /** Channel-specific metadata (messageSid, slackUserId, threadTs, etc.) */
  channelMetadata?: Record<string, string>;
  conversationId: string;
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools;
  /** When false, tools run without requireApproval (non-interactive / automated contexts) */
  interactive?: boolean;
  /** Resolved model config (string or OpenAICompatibleConfig for BYOK) */
  modelConfig?: ModelConfig;
  /** Optional scratchpad page ID for context retrieval */
  scratchpadPageId?: string;
}

interface AgentContext {
  systemPrompt: string;
  tools: Record<string, Tool>;
  /** Messages in Mastra-compatible format — passed directly to agent.stream()/generate() */
  modelMessages: MessageListInput;
  user: Awaited<ReturnType<typeof getUserById>>;
  timezone: string;
  gatherContextAgent: Agent;
  takeActionAgent: Agent;
  thinkAgent?: Agent;
  gatewayAgents: Agent[];
}

export async function buildAgentContext({
  userId,
  workspaceId,
  source,
  finalMessages,
  triggerContext,
  onMessage,
  channelMetadata,
  conversationId,
  executorTools,
  interactive = true,
  modelConfig,
  scratchpadPageId,
  scratchpadType = "mention",
}: BuildAgentContextParams): Promise<AgentContext> {
  // Load context in parallel
  const [
    user,
    persona,
    connectedIntegrations,
    skills,
    conversationRecord,
    workspace,
    customPersonalities,
    channelCtx,
  ] = await Promise.all([
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
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    }),
    getCustomPersonalities(workspaceId),
    getWorkspaceChannelContext(workspaceId),
  ]);

  // Look up linked task context
  const linkedTaskRecord = conversationRecord?.asyncJobId
    ? await prisma.task.findUnique({
        where: { id: conversationRecord.asyncJobId },
        select: { id: true, title: true, pageId: true, status: true },
      })
    : null;

  const linkedTaskDescription = linkedTaskRecord?.pageId
    ? await getPageContentAsHtml(linkedTaskRecord.pageId)
    : null;

  const linkedTask = linkedTaskRecord
    ? { ...linkedTaskRecord, description: linkedTaskDescription }
    : null;

  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";
  const personality = (metadata?.personality as string) ?? "tars";
  const pronoun = (metadata?.pronoun as PronounType) ?? undefined;
  const defaultChannel = channelCtx.defaultChannelType;
  const availableChannels = channelCtx.availableTypes;

  const isBackgroundExecution = !!linkedTask;

  // Build tools and agents in parallel (no dependency between them)
  const [
    tools,
    { gatherContextAgent, takeActionAgent, thinkAgent, gatewayAgents },
  ] = await Promise.all([
    createCoreTools({
      userId,
      workspaceId,
      timezone,
      source,
      readOnly: false,
      skills,
      onMessage,
      defaultChannel,
      availableChannels,
      isBackgroundExecution,
      triggerChannel: triggerContext?.trigger.channel,
      triggerChannelId: triggerContext?.trigger.channelId,
      userEmail: user?.email ?? undefined,
      userPhoneNumber: user?.phoneNumber ?? undefined,
    }),
    createCoreAgents({
      userId,
      workspaceId,
      timezone,
      source,
      persona: persona ?? undefined,
      skills,
      executorTools,
      triggerContext: triggerContext
        ? {
            trigger: triggerContext.trigger,
            context: triggerContext.context,
            userPersona: triggerContext.userPersona,
          }
        : undefined,
      defaultChannel,
      availableChannels,
      interactive,
      modelConfig,
    }),
  ]);

  const customPersonality = customPersonalities.find(
    (p) => p.id === personality,
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
      pronoun,
      customPersonality: customPersonality
        ? {
            text: customPersonality.text,
            useHonorifics: customPersonality.useHonorifics,
          }
        : undefined,
    },
    persona ?? "",
    workspace?.name ?? undefined,
  );

  // Integrations context
  const integrationsList = connectedIntegrations
    .map((int, index) =>
      "integrationDefinition" in int
        ? `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id})`
        : "",
    )
    .join("\n");

  systemPrompt += `
    <connected_integrations>
    Their connected tools (${connectedIntegrations.length} accounts):
    ${integrationsList}

    The orchestrator agent handles all integration operations. Delegate to it when the user needs:
    - Information from their integrations (emails, calendar, issues, etc.)
    - Actions on their integrations (send, create, update, delete)
    - Web search or URL reading
    - Gateway operations (device tasks, coding, browser automation)

    Simply delegate to the orchestrator with a clear intent describing what's needed.
    </connected_integrations>`;

  // Messaging channels context
  systemPrompt += `
    <messaging_channels>
    Channels you can reach them on: ${channelCtx.channelNames.join(", ")}
    Default: ${channelCtx.defaultChannelName}

    Scheduled tasks and notifications go via ${channelCtx.defaultChannelName} unless they say otherwise.
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
    You have access to user-defined skills (reusable workflows). When a user's request matches a skill, call get_skill to load its full instructions, then follow them step-by-step using your tools.

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
      systemPrompt += `\n\n<task_execution>
You're on this task. Get it done — don't just discuss it.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}

- Delegate to the orchestrator to do the actual work (gather information, execute actions)
- If they send a message, treat it as additional direction for this task
- This IS the task — don't create or search for other tasks about this topic
- Mark task ${linkedTask.id} as Completed ONLY when the user's original intent is fully achieved — not just when execution finishes
- Mark task ${linkedTask.id} as Blocked in ALL other cases: errors, failures, partial completion, needs input, unresolvable dependency
- When marking Blocked, always call update_task first to append a clear error/status summary to the description — what was attempted, what failed, what's needed to unblock

LONG-RUNNING SESSIONS (coding, browser):
If you start a coding session or browser session via the orchestrator, the response will include a sessionId.
After getting the sessionId, immediately call create_task with scheduling to check on it:
  title: "check [taskId:${linkedTask.id}] [sessionId:<the-session-id>] '<task title>' — read session output, report to user if done or failed, reschedule 10 min if still running"
  schedule: "FREQ=MINUTELY;INTERVAL=10"
  maxOccurrences: 1

For browser tasks, use sessionName (not sessionId) and include the intent:
  title: "check [taskId:${linkedTask.id}] [sessionName:<session-name>] [intent:<what browser was doing>] — check status, report if done, reschedule 10 min if running"
  schedule: "FREQ=MINUTELY;INTERVAL=10"
  maxOccurrences: 1

Do NOT create a scheduled task if the work completes inline (integration actions, quick writes). Only for sessions that run beyond this execution.

NOTIFYING THE USER:
When you complete the task (or it fails/blocks), use the \`send_message\` tool to notify the user.
- For completion: send a concise summary of what was accomplished
- For failure/blocked: send what happened and what's needed
- Do NOT skip notification — the user is waiting to hear back
</task_execution>`;
    } else {
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${linkedTask.id}).
</task_context>`;
    }
  }

  // Trigger context — butler needs to think first before acting
  if (triggerContext) {
    systemPrompt += `\n\n<trigger_context>
A trigger has fired: "${triggerContext.reminderText}"

1. Call the \`think\` tool FIRST — it will analyze this trigger and return an ActionPlan
2. Follow the ActionPlan it returns:
   - Execute any required work (skills, integrations, gather_context, take_action)
   - If the plan references a skill (skillId in context): call get_skill to load it, then follow the skill's instructions step-by-step
   - If \`createFollowUps\` contains items: these are RESCHEDULES of the current task, not new tasks. Call \`create_task\` with isFollowUp=true and parentTaskId set to the triggering task's ID. This reschedules the existing task instead of creating a new one.
   - If \`updateTasks\` contains items: apply each update via \`update_task\` (status changes, description updates)
   - If shouldMessage=true: craft a response summarizing what happened, match the tone specified, be concise. Use \`send_message\` to deliver it.
   - If shouldMessage=false: do NOT call send_message.
3. Do NOT create new tasks unless the ActionPlan explicitly says to. The trigger IS already a task — don't duplicate it.
4. Do NOT use create_task as a way to "deliver" or "send" a message. Use send_message for that.
5. Don't second-guess the ActionPlan's decision — it already evaluated the trigger
</trigger_context>`;
  }

  // Scratchpad context — when triggered from the daily scratchpad
  if (scratchpadPageId) {
    systemPrompt += `\n\n<scratchpad_context>
This request comes from the user's daily scratchpad. A decision agent observed what they wrote and created this intent for you.

The intent is your instruction — follow it precisely:
- If it says "do NOT execute yet" or "wait for user confirmation" — gather context and present findings, but do NOT take action (don't send emails, don't create tasks, don't message anyone)
- If it says to execute something — do it (create tasks, set reminders, search email, etc.)
- If it includes "Context from memory:" — use that context, don't re-search for the same information

Keep your response concise — this shows up on a scratchpad, not a chat conversation.
</scratchpad_context>`;
  }

  // Convert UI messages to Mastra-compatible ModelMessage format
  const modelMessages: MessageListInput = convertMessages(
    finalMessages as MessageListInput,
  ).to("AIV5.Model");

  return {
    systemPrompt,
    tools,
    modelMessages,
    user,
    timezone,
    gatherContextAgent,
    takeActionAgent,
    thinkAgent,
    gatewayAgents,
  };
}
