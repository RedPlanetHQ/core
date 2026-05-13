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
import {
  buildVoiceConstraintsBlock,
  buildActivePageBlock,
  type ScreenContext,
} from "~/services/agent/prompts/voice-mode";
import { buildOnboardingModeBlock } from "~/services/agent/prompts/onboarding-mode";
import {
  resolvePersonalityPrompt,
  type PersonalityType,
} from "~/services/agent/prompts/personality";
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
import { DirectOrchestratorTools } from "./executors";
import { getTaskPhase } from "~/services/task.phase";
import { fetchManifest } from "~/services/gateway/transport.server";
import { deriveCapabilityTags } from "~/services/gateway/utils.server";

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
  /** Voice mode flips on the spoken-reply prompt addendum */
  mode?: "voice" | "text";
  /** Optional macOS Accessibility snapshot for the frontmost window when invoked from the voice widget */
  screenContext?: ScreenContext | null;
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
  mode,
  screenContext,
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
        select: {
          id: true,
          title: true,
          pageId: true,
          status: true,
          parentTaskId: true,
          metadata: true,
        },
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

  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";
  const personality = (metadata?.personality as string) ?? "tars";
  const pronoun = (metadata?.pronoun as PronounType) ?? undefined;
  const defaultChannel = channelCtx.defaultChannelType;
  const availableChannels = channelCtx.availableTypes;

  const isBackgroundExecution = !!linkedTask;

  // Onboarding mode — active whenever the user has not finished
  // onboarding. Adds an <onboarding_mode> prompt block and three
  // onboarding-only tools (progress_update, suggest_integrations,
  // complete_onboarding). Email reading is done by delegating to the
  // gather_context subagent, not via dedicated tools on the main agent.
  const isOnboardingMode = user?.onboardingComplete === false;

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
      isOnboardingMode,
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
    mode ?? "text",
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

  // Pre-fetch manifests in parallel so we can render capability tags.
  // A failed manifest fetch renders as [capabilities: unknown] — the gateway
  // is still listed so butler can attempt delegation.
  const gatewayCapabilities = await Promise.all(
    gatewayInfos.map(async (gw) => {
      const manifest = await fetchManifest(gw.id);
      if (!manifest) return null;
      const toolNames = (manifest.manifest.tools ?? []).map((t) => t.name);
      return deriveCapabilityTags(toolNames);
    }),
  );

  const gatewaysList = gatewayInfos
    .map((gw, index) => {
      const tags = gatewayCapabilities[index];
      const capStr =
        tags === null
          ? "[capabilities: unknown]"
          : tags.length === 0
            ? "[capabilities: none]"
            : `[capabilities: ${tags.join(", ")}]`;
      const slug = gw.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const desc = gw.description ? `\n   ${gw.description}` : "";
      return `${index + 1}. **${gw.name}** ${capStr} — agent: agent-gateway_${slug}${desc}`;
    })
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
    Each gateway is a subagent you can call directly. The [capabilities: …] tag tells you what each gateway can do (browser, coding, exec, files). Pick a gateway whose capabilities match the intent — see the GATEWAYS section above for routing rules.
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
    These tasks are waiting for user input. This is background context — do NOT mention or report on these unless the user's message CLEARLY responds to one of them.

    ${waitingList}

    Rules:
    - ONLY act if the user's message clearly addresses a waiting task (answers the question, says "approved"/"go ahead", mentions the topic)
    - If it matches: call unblock_task(taskId, reason) immediately, then STOP
    - If the user's message is unrelated (greetings, other questions): ignore these tasks entirely and respond normally
    - If ambiguous: ask which task they mean
    - After unblock_task, the task resumes in its own conversation — you don't need to do anything else
    </waiting_tasks>`;
  }

  // Task context (when conversation was created from a task)
  if (linkedTask) {
    const phase = getTaskPhase(linkedTask);
    const taskMetadataForGuard =
      (linkedTask.metadata as Record<string, unknown> | null) ?? {};
    const prepDecided = taskMetadataForGuard.prepDecided === true;

    // Belt-and-suspenders: if the agent already decided prep for this task
    // (skipped to Ready or asked one question and went Waiting), do not render
    // <task_prep> again. Treat as execute. The phase guard in canTransition is
    // the primary protection against auto-loops; this prevents stale prep
    // re-renders if a job was enqueued before the buffer expired.
    const isPrepPhase = phase === "prep" && !prepDecided;
    const isExecuting = phase === "execute" || prepDecided;

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
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK of a larger task.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${skillHint}
${
  isSubtask
    ? `
SUBTASK PREP RULES:
1. You are prepping ONE CHUNK of a larger task. Read the parent task description and any prior sibling outputs for context.
2. Self-resolve questions using available context (parent description, gather_context, code reading). ONLY move to Waiting and ask the user if you genuinely cannot proceed without their input.
3. For CODING tasks (when a gateway is connected): delegate brainstorming/planning to the gateway sub-agent. Before delegating, call get_task_coding_session. If status is "starting" (gateway hasn't echoed back the sessionId — the session is still spinning up), call reschedule_self(minutesFromNow=2); do NOT call the gateway. If status is "ready", resume by default: pass sessionId, dir, and worktreeBranch. EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session with the requested agent.
4. For NON-CODING tasks: do the prep yourself using gather_context, take_action, and the readiness skills.
5. Write your plan into the task description using update_task.
6. When prep is complete, move to Review: update_task(taskId: "${linkedTask.id}", status: "Review"). Do NOT wait for user approval — subtasks auto-transition from prep to execute.
7. Send a brief summary via send_message of what you plan to do.

DO NOT:
- Execute the actual work (no sending emails, no writing code, no making changes)
- Mark the task as Done
- Create further subtasks — you are a subtask, just plan YOUR work
- Create independent top-level tasks
`
    : `
PREP RULES:
0. CHECK INPUT SHAPE FIRST. Read the task description and decide what the user gave you (see STARTING WORK > INPUT SHAPE in <capabilities>):

   - If the description is a PLAN / RUNBOOK (explicit numbered or named steps, named data sources, named tools — the user already did the planning work):
     → Treat the description AS the plan. Do NOT re-plan, do NOT propose-and-confirm, do NOT write another plan summary. Execute the steps directly.
     → If a step has a BLOCKING gap (a referenced field doesn't exist, a destination is ambiguous in a way that affects who/what gets acted on), mark Waiting and ask one blocking question at a time. Cosmetic mismatches (label drift, format choices, defaults with one obvious answer) are NOT blockers — see WHAT NOT TO ASK ABOUT.
     → When done, write the result to the description (section="Output"), send_message with results, mark Review.

   - If the description is a GOAL (a desired outcome — you need to figure out the steps):
     → Apply the COMPLEXITY rules from STARTING WORK.
     → If on second look the task is actually SIMPLE (one artifact: summary, profile, brief, recap, list, lookup, single send) → it should not have landed in prep. Skip planning. Do the actual work now using gather_context / take_action, write the result to the description (section="Output"), send the result via send_message, and mark the task Review. Do NOT produce a "plan" of how you'll do it.
     → If genuinely COMPLEX (multiple independent deliverables, irreversibly bulk, user explicitly said "plan/think through", or coding) → continue to step 1 below to do the planning prep flow.

1. Run the READINESS CHECK (see <capabilities>). Load the appropriate skill from <skills>:
   - Unclear what's needed? → load "Gather Information" skill
   - Open-ended, needs shaping? → load "Brainstorm" skill
   - Multi-step, needs decomposition? → load "Plan" skill
2. For CODING tasks (when a gateway is connected): delegate brainstorming/planning to the gateway sub-agent. Pass the task title and description. The gateway will return questions or a plan — do NOT tell it to execute. Before delegating, call get_task_coding_session. If status is "starting" (gateway hasn't echoed back the sessionId — the session is still spinning up), call reschedule_self(minutesFromNow=2); do NOT call the gateway. If status is "ready", resume by default (pass sessionId, dir, worktreeBranch). EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session.
3. For NON-CODING tasks: do the prep yourself using gather_context, take_action, and the readiness skills.
4. Write your findings/plan into the task description using update_task.
5. When prep is complete, move to Review: update_task(taskId: "${linkedTask.id}", status: "Review")
6. Send the user a summary via send_message: what you found, what the plan is, and ask them to review.
7. If this task needs decomposition: create subtasks under this task (parentTaskId: ${linkedTask.id}) in Waiting status. Each subtask should be a meaningful work chunk, NOT a phase ("Planning"/"Execution"). Write the plan summary in the parent description listing all subtasks. Move parent to Waiting and send_message with the plan.
`
}
WHEN TO GO TO WAITING instead of Review:
- You need the user to answer questions before you can plan → mark Waiting, send questions via send_message
- Gateway returned questions from the coding agent → relay to user via send_message (include sessionId), mark Waiting

WHEN TO GO STRAIGHT TO Review:
- Nothing to prep (task is already clear and simple) → move to Review immediately
- Plan is complete → write plan to description, move to Review

DO NOT:
- Execute the actual work (no sending emails, no writing code, no making changes)
- Mark the task as Done

CODING SESSION POLLING (during prep):
- "Session still running, brainstorming/planning phase" → call reschedule_self(minutesFromNow=5)
- Gateway returns questions → relay to user via send_message (include sessionId), mark Waiting
- Gateway returns plan → write to description (section: "Plan"), mark Review, send_message

NEVER write error logs or debug output into the task description.
</task_prep>`;
    } else if (isExecuting) {
      systemPrompt += `\n\n<task_execution>
You're executing this task in the background. The prep/planning phase is done — get it done.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK. Do ONLY this specific work. Do not create further subtasks. Do not look at or manage sibling tasks.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${skillHint}${
        linkedTask.status === "Waiting"
          ? `

THIS TASK IS WAITING. The user's message in this conversation is the reply that resumes it.
- Call unblock_task(taskId: "${linkedTask.id}", reason: "<the user's reply, summarized>") FIRST, then STOP. unblock_task moves the task to Ready and the system re-enqueues execution with the user's reply.
- Do NOT do the work yourself, delegate to any sub-agent (gateway, gather_context, take_action, etc.), or send a message before unblock_task — the resume handler does that.
- Exception: if the user's message is clearly NOT a reply to this task (a new unrelated request), ignore the rule above and treat it as new direction.`
          : ""
      }

RULES:
- For integration work (emails, calendar, github, etc.): delegate to the orchestrator via gather_context / take_action
- For coding, browser, shell: use gateway tools directly (coding_*, browser_*, exec_*) if connected. Before delegating coding work, call get_task_coding_session. If status is "starting" (gateway hasn't echoed back the sessionId — the session is still spinning up), call reschedule_self(minutesFromNow=2); do NOT call the gateway. If status is "ready", resume by default — pass sessionId/dir/worktreeBranch with the intent "execute the plan". EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session with the requested agent.
- If the user sends a message, treat it as additional direction for this task${
        isSubtask
          ? `
- When you complete this subtask, the system automatically starts the next one and marks the parent Done when all subtasks are done
- If you fail or get stuck, mark the PARENT task (${linkedTask.parentTaskId}) as Waiting and send_message with the error`
          : `
- If this task is complex and needs decomposition: create subtasks under this task (parentTaskId: ${linkedTask.id}) in Waiting status. Each subtask should be a meaningful work chunk, NOT a phase ("Planning"/"Execution"). Move this task to Waiting, then send_message to the user explaining the plan and asking for approval.
- The system handles sequential subtask execution automatically — when approved, it starts the first subtask. Each subtask completion triggers the next one. You do NOT manage the queue.`
      }
- Mark task ${linkedTask.id} as Review when the original intent is fully achieved. The user will move it to Done.
- When Waiting (errors, needs user input, needs approval, partial completion):
  1. call update_task(taskId: "${linkedTask.id}", status: "Waiting")
  2. call send_message explaining what's needed — MUST include the task title so the user (and future you) can identify it. Example: "Task '${linkedTask.title}' is waiting: <reason>. <what's needed to continue>"
- NEVER write error logs, debug output, or transient state into the task description. The description is for task spec, plan, and structured sections (Plan, Output, Session) only. Errors and status updates go to send_message.
- When finished:
  1. call update_task(taskId: "${linkedTask.id}", status: "Review")
  2. call send_message with a summary of what was done
- Do NOT create independent top-level tasks. ${isSubtask ? "You are a subtask — just do your work." : "You can only create subtasks under this task."}
- DESCRIPTION UPDATES: Only update the task description at phase boundaries (Waiting, plan produced, Review/Done, or when the user provides new context). Do NOT update it on every interaction.

CODING SESSIONS:
The gateway sub-agent handles all sleep/polling for coding sessions. You do NOT sleep or poll directly.

When you delegate a coding task to the gateway, it will return one of:
- Questions from the coding agent → relay to user via send_message (include sessionId in the message), mark task Waiting. Do NOT write the question into the task description — the conversation thread is the source of truth.
- A plan from the coding agent → you are in EXECUTION mode (user already approved the plan). Call the gateway again immediately with sessionId, dir, and intent "execute the plan" to trigger Phase 3 execution. Do NOT mark task Review again — the plan was already reviewed.
- Execution results → write results to task description using update_task(section: "Output", description: results_html), mark task Review.
- "Session still running, brainstorming/planning phase" → call reschedule_self(minutesFromNow=5) to check back soon.
- "Session still running, execution phase" → call reschedule_self(minutesFromNow=10). The CodingSession row already records the sessionId/dir — no need to save it anywhere.
- Error → update_task(status: "Waiting") then send_message with the error detail. Do NOT write errors into the task description.

When the user answers a question, resume the coding session with the answer. Do NOT write the answer into the task description.

On re-execution after reschedule (we rescheduled ourselves to poll progress — no user input in between): call get_task_coding_session to resolve the latest coding session for this task. If status is "starting" (sessionId hasn't been assigned yet), call reschedule_self(minutesFromNow=2) and try again. If status is "ready", resume that session — delegate to the gateway with the returned sessionId, dir, and intent "execute the plan" so the gateway enters Phase 3 (execution) rather than re-doing planning. Only pass user answers if the user has replied since the last run. EXCEPTION: if the user replied explicitly asking for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session.

Do NOT sleep, poll coding_read_session, or create scheduled tasks yourself — the gateway handles that.
</task_execution>`;
    } else {
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${linkedTask.id}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${linkedTask.id}).${linkedTask.status === "Waiting" ? `\nThis task is WAITING. If the user's message is a reply to this task, call unblock_task(taskId: "${linkedTask.id}", reason: "<user's reply summarized>") FIRST and then STOP. Do not do the work yourself or delegate to any sub-agent — unblock_task triggers the resume.` : ""}
</task_context>`;
    }
  }

  // Trigger context — butler needs to think first before acting
  if (triggerContext) {
    const isTriggerFollowUp =
      triggerContext.trigger.type === "reminder_followup" ||
      (triggerContext.trigger.data as any)?.isFollowUp === true;
    const isRecurring =
      (triggerContext.trigger.data as any)?.isRecurring === true;

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

  // Onboarding-mode block — appended late so it takes precedence over
  // generic default behavior. Active during the user's very first
  // webapp conversation, gated by user.onboardingComplete === false.
  if (isOnboardingMode) {
    systemPrompt += `\n\n${buildOnboardingModeBlock()}`;
  }

  // Voice-mode constraint block — only when butler will be heard out
  // loud AND the personality didn't already define its own voice
  // variant. Personalities with a dedicated voice prompt carry their
  // own spoken-style rules; we don't want to double up.
  if (mode === "voice" && !customPersonality) {
    const personalityHasVoiceVariant = resolvePersonalityPrompt(
      personality as PersonalityType,
      "voice",
    ).hasVoiceVariant;
    if (!personalityHasVoiceVariant) {
      systemPrompt += `\n\n${buildVoiceConstraintsBlock()}`;
    }
  } else if (mode === "voice" && customPersonality) {
    // Custom personalities don't have voice variants — always apply
    // the generic spoken-style guard so TTS reads cleanly.
    systemPrompt += `\n\n${buildVoiceConstraintsBlock()}`;
  }

  // Active-page snapshot — flows through in BOTH modes whenever the
  // desktop widget captured AX text from the frontmost macOS window.
  const activePageBlock = buildActivePageBlock(screenContext);
  if (activePageBlock) {
    systemPrompt += `\n\n${activePageBlock}`;
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
