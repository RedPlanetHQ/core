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
import { getTaskPhase } from "~/services/task.phase";

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
    waitingTasks,
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
    // Waiting tasks — surfaced in channel context so agent can unblock them
    !["web", "core", "task"].includes(source)
      ? prisma.task.findMany({
          where: { workspaceId, status: "Waiting" },
          select: { id: true, title: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 10,
        })
      : ([] as { id: string; title: string; updatedAt: Date }[]),
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

  // Waiting tasks context — helps channel agent recognize replies to blocked tasks
  if (waitingTasks.length > 0) {
    const waitingList = waitingTasks
      .map(
        (t) =>
          `- "${t.title}" (ID: ${t.id}) — Waiting since ${t.updatedAt.toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      )
      .join("\n");
    systemPrompt += `
    <waiting_tasks>
    You have tasks waiting for user input. When the user's message responds to one of these, call unblock_task — do NOT just reply conversationally or create a new task.

    ${waitingList}

    Rules:
    - If the reply clearly addresses one task: call unblock_task(taskId, reason) immediately
    - If ambiguous: list the waiting tasks and ask which one they mean
    - The reason should capture the user's reply/decision (e.g., "User approved: go ahead with the deployment")
    - After unblock_task, the task resumes in its own conversation — you don't need to do anything else
    </waiting_tasks>`;
  }

  // Task context (when conversation was created from a task)
  if (linkedTask) {
    const phase = getTaskPhase(linkedTask);
    const isPrepPhase = phase === "prep";
    const isExecuting = phase === "execute";

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

    if (isPrepPhase) {
      systemPrompt += `\n\n<task_prep>
You're preparing this task — NOT executing it. Your job is to gather information, clarify scope, and produce a plan. Do NOT do the actual work yet.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${skillHint}

PREP RULES:
1. Run the READINESS CHECK (see <capabilities>). Load the appropriate skill from <skills>:
   - Unclear what's needed? → load "Gather Information" skill
   - Open-ended, needs shaping? → load "Brainstorm" skill
   - Multi-step, needs decomposition? → load "Plan" skill
2. For CODING tasks (when a gateway is connected): delegate brainstorming/planning to the gateway sub-agent. Pass the task title and description. The gateway will return questions or a plan — do NOT tell it to execute.${lastCodingSession?.externalSessionId ? `\n   A coding session already exists — resume it:\n   sessionId: ${lastCodingSession.externalSessionId}, agent: ${lastCodingSession.agent}${lastCodingSession.dir ? `, dir: ${lastCodingSession.dir}` : ""}${lastCodingSession.worktreeBranch ? `, branch: ${lastCodingSession.worktreeBranch}` : ""}` : ""}
3. For NON-CODING tasks: do the prep yourself using gather_context, take_action, and the readiness skills.
4. Write your findings/plan into the task description using update_task.
5. When prep is complete, move to Review: update_task(taskId: "${linkedTask.id}", status: "Review")
6. Send the user a summary via send_message: what you found, what the plan is, and ask them to review.

WHEN TO GO TO WAITING instead of Review:
- You need the user to answer questions before you can plan → mark Waiting, send questions via send_message
- Gateway returned questions from the coding agent → write to task description, mark Waiting

WHEN TO GO STRAIGHT TO Review:
- Nothing to prep (task is already clear and simple) → move to Review immediately
- Plan is complete → write plan to description, move to Review

DO NOT:
- Execute the actual work (no sending emails, no writing code, no making changes)
- Mark the task as Done
- Create independent top-level tasks${isSubtask ? "" : `
- If this task needs decomposition: create subtasks under this task (parentTaskId: ${linkedTask.id}), write the plan, move to Review, send_message with the plan`}

CODING SESSION POLLING (during prep):
- "Session still running, brainstorming/planning phase" → call reschedule_self(minutesFromNow=5)
- Gateway returns questions → write to description (section: "Questions"), mark Waiting, send_message
- Gateway returns plan → write to description (section: "Plan"), mark Review, send_message

NEVER write error logs or debug output into the task description.
</task_prep>`;
    } else if (isExecuting) {
      systemPrompt += `\n\n<task_execution>
You're executing this task in the background. The prep/planning phase is done — get it done.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK. Do ONLY this specific work. Do not create further subtasks. Do not look at or manage sibling tasks.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${skillHint}

RULES:
- For integration work (emails, calendar, github, etc.): delegate to the orchestrator via gather_context / take_action
- For coding, browser, shell: use gateway tools directly (coding_*, browser_*, exec_*) if connected${lastCodingSession?.externalSessionId ? `\n- A coding session already exists for this task — resume it with intent "execute the plan" to trigger Phase 3 execution:\n  sessionId: ${lastCodingSession.externalSessionId}, agent: ${lastCodingSession.agent}${lastCodingSession.dir ? `, dir: ${lastCodingSession.dir}` : ""}${lastCodingSession.worktreeBranch ? `, branch: ${lastCodingSession.worktreeBranch}` : ""}` : ""}
- If the user sends a message, treat it as additional direction for this task${isSubtask ? `
- When you complete this subtask, the system automatically starts the next one and marks the parent Done when all subtasks are done
- If you fail or get stuck, mark the PARENT task (${linkedTask.parentTaskId}) as Waiting and send_message with the error` : `
- If this task is complex and needs decomposition: create subtasks under this task (parentTaskId: ${linkedTask.id}) in Todo, move this task to Waiting, then send_message to the user explaining the plan and asking for approval
- The system handles sequential subtask execution automatically — when approved, it starts the first subtask. Each subtask completion triggers the next one. You do NOT manage the queue.`}
- Mark task ${linkedTask.id} as Review when the original intent is fully achieved. The user will move it to Done.
- When Waiting (errors, needs user input, needs approval, partial completion):
  1. call update_task(taskId: "${linkedTask.id}", status: "Waiting")
  2. call send_message explaining what's needed — MUST include the task title so the user (and future you) can identify it. Example: "Task '${linkedTask.title}' is waiting: <reason>. <what's needed to continue>"
- NEVER write error logs, debug output, or transient state into the task description. The description is for task spec, plan, and structured sections (Questions, Plan, Output, Session) only. Errors and status updates go to send_message.
- When finished:
  1. call update_task(taskId: "${linkedTask.id}", status: "Review")
  2. call send_message with a summary of what was done
- Do NOT create independent top-level tasks. ${isSubtask ? "You are a subtask — just do your work." : "You can only create subtasks under this task."}
- DESCRIPTION UPDATES: Only update the task description at phase boundaries (Waiting, plan produced, Review/Done, or when the user provides new context). Do NOT update it on every interaction.

CODING SESSIONS:
The gateway sub-agent handles all sleep/polling for coding sessions. You do NOT sleep or poll directly.

When you delegate a coding task to the gateway, it will return one of:
- Questions from the coding agent → write questions to the task description using update_task(section: "Questions", appendToSection: true, description: "<p><strong>Q:</strong> question text</p>"). Then relay to user via send_message, include sessionId in message, mark task Waiting.
- A plan from the coding agent → you are in EXECUTION mode (user already approved the plan). Call the gateway again immediately with sessionId, dir, and intent "execute the plan" to trigger Phase 3 execution. Do NOT mark task Review again — the plan was already reviewed.
- Execution results → write results to task description using update_task(section: "Output", description: results_html), mark task Review.
- "Session still running, brainstorming/planning phase" → call reschedule_self(minutesFromNow=5) to check back soon.
- "Session still running, execution phase" → save sessionId to task description using update_task(section: "Session", description: session_html), call reschedule_self(minutesFromNow=10) to try again later.
- Error → update_task(status: "Waiting") then send_message with the error detail. Do NOT write errors into the task description.

When the user answers a question, append the answer to the Q&A log: update_task(section: "Questions", appendToSection: true, description: "<p><strong>A:</strong> user's answer</p>"). Then resume the coding session with the answer.

On re-execution after reschedule: read sessionId and dir from task description, delegate to gateway with the sessionId, dir, and intent "execute the plan" — this ensures the gateway enters Phase 3 (execution) rather than re-doing planning. Only pass user answers if the user has replied since the last run.

Do NOT sleep, poll coding_read_session, or create scheduled tasks yourself — the gateway handles that.
</task_execution>`;
    } else {
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${linkedTask.id}).${linkedTask.status === "Waiting" ? `\nThis task is WAITING. The user's reply in this conversation will automatically resume the task. Just acknowledge their input and let them know the task will continue.` : ""}
</task_context>`;
    }
  }

  // Trigger context — butler needs to think first before acting
  if (triggerContext) {
    const isTriggerFollowUp = triggerContext.trigger.type === "reminder_followup" ||
      (triggerContext.trigger.data as any)?.isFollowUp === true;
    const isRecurring = (triggerContext.trigger.data as any)?.isRecurring === true;

    systemPrompt += `\n\n<trigger_context>
A trigger has fired: "${triggerContext.reminderText}"${isTriggerFollowUp ? `\nThis is a FOLLOW-UP trigger. Do NOT create further follow-ups — one level only. If the issue is still unresolved, mark the task Waiting and notify the user.` : ""}${isRecurring ? `\nThis is a RECURRING task. Do NOT update the task description — send results via send_message only. Do NOT mark the task as Done — the system handles the recurring lifecycle automatically. If you need to change status, use Review.` : ""}

1. Call the \`think\` tool FIRST — it will analyze this trigger and return an ActionPlan
2. Follow the ActionPlan it returns:
   - Execute any required work (skills, integrations, gather_context, take_action)
   - If the plan references a skill (skillId in context): call get_skill to load it, then follow the skill's instructions step-by-step
   - If \`createFollowUps\` contains items: these are RESCHEDULES of the current task, not new tasks. Call \`create_task\` with isFollowUp=true and parentTaskId set to the triggering task's ID.${isTriggerFollowUp ? ` HOWEVER: this trigger is itself a follow-up — IGNORE any createFollowUps. Do not chain follow-ups.` : ""}
   - If \`updateTasks\` contains items: apply each update via \`update_task\` (status changes, description updates)${isRecurring ? ` — EXCEPT: skip any description updates and skip any status=Done (the system loops recurring tasks automatically)` : ""}
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
