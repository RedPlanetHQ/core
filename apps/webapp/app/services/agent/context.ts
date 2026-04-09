/**
 * Shared agent context builder.
 *
 * Extracts the common setup used by web chat (stream + no_stream) and
 * async channels (WhatsApp, Email). Each caller gets back everything
 * needed to call Mastra Agent's stream() / generate(), plus the
 * orchestrator subagent.
 */

import { type Tool } from "ai";
import { type Agent, convertMessages } from "@mastra/core/agent";

import { getUserById } from "~/models/user.server";
import { getPersonaDocumentForUser } from "~/services/document.server";
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
import { getLastCodingSession } from "~/services/coding/coding-session.server";
import { DirectOrchestratorTools } from "./executors";

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
  /** True when running as a background task — ask_user should not be registered */
  isBackgroundExecution: boolean;
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
    allSkills,
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

  // Exclude default skills (those with skillType in metadata) from the dynamic skills list
  const skills = allSkills.filter((s) => {
    const meta = s.metadata as Record<string, unknown> | null;
    return !meta?.skillType;
  });

  // Look up linked task context
  const linkedTaskRecord = conversationRecord?.asyncJobId
    ? await prisma.task.findUnique({
        where: { id: conversationRecord.asyncJobId },
        select: { id: true, title: true, pageId: true, status: true, parentTaskId: true, metadata: true },
      })
    : null;

  const linkedTaskDescription = linkedTaskRecord?.pageId
    ? await getPageContentAsHtml(linkedTaskRecord.pageId)
    : null;

  // Fetch parent task context if this is a subtask
  const parentTaskRecord = linkedTaskRecord?.parentTaskId
    ? await prisma.task.findUnique({
        where: { id: linkedTaskRecord.parentTaskId },
        select: { id: true, title: true, pageId: true },
      })
    : null;
  const parentTaskDescription = parentTaskRecord?.pageId
    ? await getPageContentAsHtml(parentTaskRecord.pageId)
    : null;

  const linkedTask = linkedTaskRecord
    ? { ...linkedTaskRecord, description: linkedTaskDescription }
    : null;

  const lastCodingSession = linkedTaskRecord
    ? await getLastCodingSession(linkedTaskRecord.id, workspaceId)
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
      currentTaskId: linkedTask?.id,
      triggerChannel: triggerContext?.trigger.channel,
      triggerChannelId: triggerContext?.trigger.channelId,
      userEmail: user?.email ?? undefined,
      userPhoneNumber: user?.phoneNumber ?? undefined,
      executorTools,
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
      conversationId,
      taskId: linkedTask?.id,
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
    persona ?? undefined,
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

  const executor = executorTools ?? new DirectOrchestratorTools();
  const gatewayInfos = await executor.getGateways(workspaceId);
  const gatewaysList = gatewayInfos
    .map(
      (gw, index) =>
        `${index + 1}. **${gw.name}** (agent: agent-gateway_${gw.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}): ${gw.description}`,
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

    Simply delegate to the orchestrator with a clear intent describing what's needed.
    </connected_integrations>
    
    <connected_gateways>
    Each gateway is a subagent you can call directly. Give it a clear intent and it will pick the right tool (coding_*, browser_*, exec_*).
    ${gatewaysList || "No gateways connected."}
    </connected_gateways>
    `;

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
        const slug = s.title
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        return `${i + 1}. "${s.title}" (id: ${s.id}, slash: /${slug})${desc ? ` — ${desc}` : ""}`;
      })
      .join("\n");

    systemPrompt += `
    <skills>
    You have access to user-defined skills (reusable workflows). When a user's request matches a skill — or they invoke one with a slash command like /skill-name — call get_skill to load its full instructions, then follow them step-by-step using your tools.

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

    const isSubtask = !!linkedTask.parentTaskId;
    const taskMeta = (linkedTask.metadata as Record<string, unknown>) ?? {};
    const taskSkillId = taskMeta.skillId as string | undefined;

    // Try to find a matching skill for this task
    let skillHint = "";
    if (taskSkillId) {
      const matchedSkill = skills.find((s: any) => s.id === taskSkillId);
      if (matchedSkill) {
        skillHint = `\nA skill is attached to this task: "${matchedSkill.title}" (ID: ${matchedSkill.id}). Call get_skill to load its instructions before starting.`;
      }
    }

    if (isExecuting) {
      systemPrompt += `\n\n<task_execution>
You're executing this task in the background. Get it done.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}${isSubtask ? `\nThis is a SUBTASK. Do ONLY this specific work. Do not create further subtasks. Do not look at or manage sibling tasks.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${skillHint}

RULES:
- For integration work (emails, calendar, github, etc.): delegate to the orchestrator via gather_context / take_action
- For coding, browser, shell: use gateway tools directly (coding_*, browser_*, exec_*) if connected${lastCodingSession?.externalSessionId ? `\n- A coding session already exists for this task — prefer resuming it over starting a new one:\n  sessionId: ${lastCodingSession.externalSessionId}, agent: ${lastCodingSession.agent}${lastCodingSession.dir ? `, dir: ${lastCodingSession.dir}` : ""}${lastCodingSession.worktreeBranch ? `, branch: ${lastCodingSession.worktreeBranch}` : ""}` : ""}
- If the user sends a message, treat it as additional direction for this task${isSubtask ? `
- When you complete this subtask, the system automatically starts the next one and marks the parent Completed when all subtasks are done
- If you fail or get stuck, mark the PARENT task (${linkedTask.parentTaskId}) as Blocked and send_message with the error` : `
- If this task is complex and needs decomposition: create subtasks under this task (parentTaskId: ${linkedTask.id}) in Backlog, move this task to Blocked, then send_message to the user explaining the plan and asking for approval
- The system handles sequential subtask execution automatically — when unblocked, it starts the first subtask. Each subtask completion triggers the next one. You do NOT manage the queue.`}
- Mark task ${linkedTask.id} as Completed ONLY when the original intent is fully achieved
- When Blocked (errors, needs user input, needs approval, partial completion):
  1. call update_task(taskId: "${linkedTask.id}", status: "Blocked", description: "<append what was attempted and what's needed>")
  2. call send_message explaining what's needed — MUST include the task title so the user (and future you) can identify it. Example: "Task '${linkedTask.title}' is blocked: <reason>. <what's needed to unblock>"
- When Completed:
  1. call update_task(taskId: "${linkedTask.id}", status: "Completed")
  2. call send_message with a summary of what was done
- Do NOT create independent top-level tasks. ${isSubtask ? "You are a subtask — just do your work." : "You can only create subtasks under this task."}

LONG-RUNNING SESSIONS (coding, browser):
If you start a coding session via the orchestrator, the response includes a sessionId.

BEFORE using reschedule_self, save state to the task description:
  - Call update_task to append: sessionId, worktreePath (if any), what was requested

WAIT PATTERN:
1. Quick poll: sleep(60) then coding_read_session(sessionId) — repeat up to 3 times
2. If still running after 3 polls: call reschedule_self(minutesFromNow=10)
3. On re-execution (you'll see [reschedule:N/6] in your context): read sessionId from the task description, then coding_read_session
   - completed → update_task(status: "Completed") then send_message with result
   - running → reschedule_self(10) again (max 6 total reschedules)
   - error → update_task(status: "Blocked") then send_message with error detail
4. After 6 reschedules (~60 min): update_task(status: "Blocked") then send_message "coding session timed out"

Do NOT create a scheduled task to check on sessions — use reschedule_self instead.
</task_execution>`;
    } else {
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${linkedTask.id}).${linkedTask.status === "Blocked" ? `\nThis task is BLOCKED. If the user says to proceed, approves, or says the issue is resolved — call unblock_task(taskId: "${linkedTask.id}", reason: "<what changed>"). Do NOT create a new task.` : ""}
</task_context>`;
    }
  }

  // Trigger context — butler needs to think first before acting
  if (triggerContext) {
    const isTriggerFollowUp = triggerContext.trigger.type === "reminder_followup" ||
      (triggerContext.trigger.data as any)?.isFollowUp === true;

    systemPrompt += `\n\n<trigger_context>
A trigger has fired: "${triggerContext.reminderText}"${isTriggerFollowUp ? `\nThis is a FOLLOW-UP trigger. Do NOT create further follow-ups — one level only. If the issue is still unresolved, mark the task Blocked and notify the user.` : ""}

1. Call the \`think\` tool FIRST — it will analyze this trigger and return an ActionPlan
2. Follow the ActionPlan it returns:
   - Execute any required work (skills, integrations, gather_context, take_action)
   - If the plan references a skill (skillId in context): call get_skill to load it, then follow the skill's instructions step-by-step
   - If \`createFollowUps\` contains items: these are RESCHEDULES of the current task, not new tasks. Call \`create_task\` with isFollowUp=true and parentTaskId set to the triggering task's ID.${isTriggerFollowUp ? ` HOWEVER: this trigger is itself a follow-up — IGNORE any createFollowUps. Do not chain follow-ups.` : ""}
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
    isBackgroundExecution,
  };
}
