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
  buildDefaultVoiceToneBlock,
  buildSpokenMechanicsBlock,
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
import { BUILTIN_SKILLS } from "~/services/skills.builtin";
import { getDefaultSkill } from "~/services/skills.server";
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
          select: { id: true, displayId: true, title: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 10,
        })
      : ([] as {
          id: string;
          displayId: string | null;
          title: string;
          updatedAt: Date;
        }[]),
  ]);

  // Exclude reserved defaults (Persona + Watch Rules) from the dynamic
  // skills list — those have separate injection paths:
  //   - Persona is rendered inline into the personality block.
  //   - Watch Rules is loaded by the decision agent (decision.ts) and pinned
  //     into the butler's <trigger_context> by skill ID (see below) so it
  //     gets fetched via get_skill on every trigger turn.
  // Other default skills (Morning Brief, etc.) stay in the list so the agent
  // can discover them via <skills> and call get_skill, and so the
  // scheduled-task skillHint lookup below can resolve them.
  const skills = allSkills.filter((s) => {
    const meta = s.metadata as Record<string, unknown> | null;
    const skillType = meta?.skillType as string | undefined;
    return skillType !== "persona" && skillType !== "watch-rules";
  });

  // Look up linked task context
  const linkedTaskRecord = conversationRecord?.asyncJobId
    ? await prisma.task.findUnique({
        where: { id: conversationRecord.asyncJobId },
        select: {
          id: true,
          displayId: true,
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
        select: { id: true, displayId: true, title: true, pageId: true },
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

  // Skills context — merge DB-backed user skills with always-available
  // built-ins. Built-ins use synthetic `builtin:*` IDs so get_skill can
  // route the lookup correctly; the user's skills UI never sees them.
  const skillEntries: Array<{
    id: string;
    title: string;
    shortDescription?: string;
  }> = [
    ...skills.map((s: any) => {
      const meta = s.metadata as Record<string, unknown> | null;
      return {
        id: s.id,
        title: s.title,
        shortDescription: meta?.shortDescription as string | undefined,
      };
    }),
    ...BUILTIN_SKILLS.map((b) => ({
      id: b.id,
      title: b.title,
      shortDescription: b.shortDescription,
    })),
  ];

  if (skillEntries.length > 0) {
    const skillsList = skillEntries
      .map((s, i) => {
        const slug = s.title
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        return `${i + 1}. "${s.title}" (id: ${s.id}, slash: /${slug})${s.shortDescription ? ` — when to use: ${s.shortDescription}` : ""}`;
      })
      .join("\n");

    systemPrompt += `
    <skills>
    User-defined skills are reusable workflows or knowledge. Each skill's description tells you when it applies — the title is just a label.

    SKILL CHECK FIRST — on EVERY turn, before you delegate to gather_context / take_action / gateway, before you compose a message, before you call any tool: scan the list below against the user's current intent (and against the task title/description if a task is in context). If any skill matches by intent OR is named/implied in the text (e.g. "run brief skill" → load the "Brief from work" skill, "/brainstorm" → load that skill), call get_skill on it and follow its instructions. The skill is your script; it tells you what to delegate. Only proceed without a skill if NONE applies.

    PICK BY INTENT, NOT BY NAME. Match the user's current intent against what each skill is for:
    - Solving a bug / chasing an error / something broken → a debugging skill
    - Shaping a new feature / open-ended problem / "let's think about" → a brainstorm skill
    - Writing in a specific voice or format (investor update, weekly digest, code review) → that format/style skill
    - Planning multi-step work / decomposing → a planning skill
    A skill applies if its purpose helps with what the user is actually trying to do, even if they never said the skill's name.

    LOAD TRIGGERS:
    - Current intent matches a skill's purpose → call get_skill and follow it.
    - User invokes /skill-name (slash command) → load that one directly.
    - User names a skill by title (e.g. "use the brief skill", "run X skill") → load it.
    - Task title/description names or implies a skill → load it before delegating.
    - Multiple skills could apply → prefer the most specific. If none clearly fit, don't force one.

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
          `- "${t.title}" (ID: ${t.displayId ?? t.id}) — Waiting since ${t.updatedAt.toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
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
    // Agent-facing handles: prefer displayId so tool calls and chatter stay
    // in the tk-… namespace. Fall back to UUID for older rows that pre-date
    // the displayId trigger.
    const taskHandle = linkedTask.displayId ?? linkedTask.id;
    const parentHandle =
      parentTaskRecord?.displayId ??
      parentTaskRecord?.id ??
      linkedTask.parentTaskId ??
      "";

    const isSubtask = !!linkedTask.parentTaskId;

    // Execute-first lifecycle. New tasks land in execute mind. The agent
    // self-promotes to plan mind via the enter_plan_mode tool when it
    // genuinely can't see the shape of the work (ambiguous goal, missing
    // context, open-ended brainstorm). In plan mind it gathers info and
    // writes a plan into the task description, then calls exit_plan_mode
    // to drop back into execute. The phase metadata tracks which block to
    // render. <task_context> below covers Review/Done — inert states where
    // the task is in scope but you're not actively driving it.
    const phase = getTaskPhase(linkedTask);
    const isActive = linkedTask.status !== "Review" && linkedTask.status !== "Done";
    const isPlanning = isActive && phase === "prep";
    const isExecuting = isActive && !isPlanning;

    if (isPlanning) {
      systemPrompt += `\n\n<task_planning>
You're in PLAN mind because you (or a prior turn) called enter_plan_mode on this task. Your job is to gather information, clarify scope, and produce a plan. Do NOT do the actual work yet.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${taskHandle}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK of a larger task.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}
${
  isSubtask
    ? `
SUBTASK PLAN RULES:
1. You are planning ONE CHUNK of a larger task. Read the parent task description and any prior sibling outputs for context.
2. Self-resolve questions using available context (parent description, gather_context, code reading). ONLY move to Waiting and ask the user if you genuinely cannot proceed without their input.
3. For CODING tasks (when a gateway is connected): delegate brainstorming/planning to the gateway sub-agent. Before delegating, call get_task_coding_session. If status is "starting" (gateway hasn't echoed back the sessionId — the session is still spinning up), call reschedule_self(minutesFromNow=2); do NOT call the gateway. If status is "ready", resume by default: pass sessionId, dir, and worktreeBranch. EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session with the requested agent.
4. For NON-CODING tasks: do the planning yourself using gather_context, take_action, and the readiness skills.
5. Write your plan into the task description using update_task with a <plan>...</plan> section.
6. When the plan is ready, call exit_plan_mode. On your next turn you'll be back in execute mind with the plan in front of you.
7. Send a brief summary via send_message of what you plan to do.

DO NOT:
- Execute the actual work in plan mind (no sending emails, no writing code, no making changes)
- Mark the task as Review or Done
- Create further subtasks — you are a subtask, just plan YOUR work
- Create independent top-level tasks
`
    : `
PLAN RULES:
0. CHECK INPUT SHAPE FIRST. Read the task description and decide what the user gave you (see STARTING WORK > INPUT SHAPE in <capabilities>):

   - If the description is a PLAN / RUNBOOK (explicit numbered or named steps, named data sources, named tools — the user already did the planning work):
     → You shouldn't be in plan mind. Call exit_plan_mode and execute the steps directly.

   - If the description is a GOAL (a desired outcome — you need to figure out the steps):
     → Apply the COMPLEXITY rules from STARTING WORK.
     → If on second look the task is actually SIMPLE (one artifact: summary, profile, brief, recap, list, lookup, single send) → call exit_plan_mode. Then in execute mind, just do it using gather_context / take_action, write the result to the description via update_task with <outcome>...</outcome> HTML, send the result via send_message, and mark Review. Do NOT produce a "plan" of how you'll do it.
     → If genuinely COMPLEX (multiple independent deliverables, irreversibly bulk, user explicitly said "plan/think through", or coding) → continue to step 1 below to do the planning.

1. Run the READINESS CHECK (see <capabilities>). Load the appropriate skill from <skills>:
   - Unclear what's needed? → load "Gather Information" skill
   - Open-ended, needs shaping? → load "Brainstorm" skill
   - Multi-step, needs decomposition? → load "Plan" skill
   - Considering splitting into subtasks? → load "Decompose Task" skill (built-in)
2. For CODING tasks (when a gateway is connected): delegate brainstorming/planning to the gateway sub-agent. Pass the task title and description. The gateway will return questions or a plan — do NOT tell it to execute. Before delegating, call get_task_coding_session. If status is "starting" (gateway hasn't echoed back the sessionId — the session is still spinning up), call reschedule_self(minutesFromNow=2); do NOT call the gateway. If status is "ready", resume by default (pass sessionId, dir, worktreeBranch). EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit the sessionId so the gateway starts a new session.
3. For NON-CODING tasks: do the planning yourself using gather_context, take_action, and the readiness skills.
4. Write your findings/plan into the task description using update_task with a <plan>...</plan> section.
5. When the plan is ready, call exit_plan_mode. On your next turn you'll be back in execute mind with the plan in front of you and you'll act on it.
6. Send the user a brief summary via send_message: what you found and what the plan is.
7. If this task needs decomposition (the Decompose Task skill says SPLIT): exit_plan_mode first. Subtasks are created in execute mind after exiting, NOT in plan mind.
`
}
WHEN TO ASK THE USER (mark Waiting):
- You hit a BLOCKING question you cannot self-resolve from available context → update_task(status: "Waiting") + send_message with ONE focused question. On resume you stay in plan mind until you call exit_plan_mode.
- Gateway returned questions from the coding agent → relay to user via send_message (include sessionId), mark Waiting.

WHEN TO EXIT PLAN MIND (call exit_plan_mode):
- The plan is written into the description and you're ready to act.
- The task turned out to be simpler than expected — just exit and do it in execute mind.
- The description was already a runbook — exit and execute.

DO NOT:
- Execute the actual work in plan mind (no sending emails, no writing code, no making changes)
- Mark the task as Review or Done — exit_plan_mode + execute mind handles completion

CODING SESSION POLLING (during plan mind):
- "Session still running, brainstorming/planning phase" → call reschedule_self(minutesFromNow=5)
- Gateway returns questions → relay to user via send_message (include sessionId), mark Waiting
- Gateway returns plan → write to description via update_task with <plan>...</plan> HTML, call exit_plan_mode, send_message

NEVER write error logs or debug output into the task description.
</task_planning>`;
    } else if (isExecuting) {
      systemPrompt += `\n\n<task_execution>
You're handling this task. Default mind: EXECUTE. Read the task, do the work, mark Review when done. If you genuinely can't see the shape (ambiguous goal, missing context, open-ended brainstorm), call enter_plan_mode to switch to PLAN mind.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${taskHandle}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK. Do ONLY this specific work. Do not create further subtasks. Do not look at or manage sibling tasks.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${
        linkedTask.status === "Waiting"
          ? `

THIS TASK IS WAITING. The user's message in this conversation is the reply that resumes it.
- Call unblock_task(taskId: "${taskHandle}", reason: "<the user's reply, summarized>") FIRST, then STOP. unblock_task moves the task to Ready and the system re-enqueues execution with the user's reply.
- Do NOT do the work yourself, delegate to any sub-agent (gateway, gather_context, take_action, etc.), or send a message before unblock_task — the resume handler does that.
- Exception: if the user's message is clearly NOT a reply to this task (a new unrelated request), ignore the rule above and treat it as new direction.`
          : ""
      }

RULES:
- SHAPE OF THE INPUT. Read the description first.
  - PLAN / RUNBOOK (numbered steps, named tools, the user did the planning) → execute the steps in order. Don't re-plan. If a step has a blocking gap (referenced field missing, destination ambiguous in a way that changes the action), mark Waiting + send_message with ONE focused question. Cosmetic mismatches and obvious defaults are NOT blockers.
  - GOAL (desired outcome, no steps given) → just execute. If the work is genuinely big (multiple independent deliverables, irreversibly bulk, or the user explicitly said "plan/decompose"), load the "Decompose Task" skill from <skills> and let it tell you whether and how to split. Otherwise: do it directly.
- ROUTING.
  - Integration work (email, calendar, github, etc.) → delegate to the orchestrator via gather_context / take_action.
  - Coding / browser / shell → use the gateway tools directly (coding_*, browser_*, exec_*) when a gateway is connected. Before delegating coding work, call get_task_coding_session. If status is "starting", call reschedule_self(minutesFromNow=2). If "ready", resume by default (sessionId, dir, worktreeBranch). EXCEPTION: if the user asked for a fresh session or a different coding agent, omit sessionId so a new session starts.
- IF the user sends a new message mid-execution → treat as additional direction for this task.${
        isSubtask
          ? `
- Subtask completion: when your work is done, call update_task(status: "Review"). The system marks the parent Done when all sibling subtasks complete. Do NOT touch the parent.
- If you fail or get blocked, mark YOURSELF Waiting + send_message referencing both this subtask title and the parent title so the user can identify it. Do NOT cascade to the parent — siblings may still be running.`
          : `
- If this task warrants decomposition (you loaded the Decompose Task skill and it says SPLIT), follow the skill's instructions:
  - Create subtasks via create_task with parentTaskId = ${taskHandle}. Subtasks default to Ready and start their own execution cycle through the editing buffer.
  - Write the breakdown into THIS task's description via update_task with a <plan> section.
  - send_message as a heads-up: "Splitting this into A, B, C — each starts in 2 min. Stop me if wrong." Do NOT move this task to Waiting — the buffer gives the user a veto window. This task stays Working until all subtasks complete; the system auto-marks it Done.`
      }
- COMPLETION. When the original intent is achieved → update_task(taskId: "${taskHandle}", status: "Review") + send_message with a summary. The user moves it to Done.
- BLOCKERS (need user input — clarification, missing fact, approval for irreversible action):
  1. update_task(taskId: "${taskHandle}", status: "Waiting")
  2. send_message that names the task title so the user can identify it. Example: "Task '${linkedTask.title}' is waiting: <reason>. <what's needed to continue>"
- DO NOT create independent top-level tasks. ${isSubtask ? "You are a subtask — just do your work." : "Subtasks under this task only."}
- DO NOT mark Done — that's the user's call.
- DESCRIPTION UPDATES. Only at meaningful boundaries: Waiting (record what's blocked), decomposition (record the plan), Review (record the outcome), or when the user provides new context. Never write error logs, debug output, or transient state into the description.

CODING SESSIONS:
The gateway sub-agent owns all sleep/polling for coding sessions. You do NOT sleep or poll directly.

When you delegate a coding task to the gateway, it will return one of:
- Questions from the coding agent → relay to user via send_message (include sessionId), mark task Waiting. Don't write the question into the task description.
- A plan from the coding agent → you're in EXECUTION mode (user already approved the plan). Call the gateway again immediately with sessionId, dir, and intent "execute the plan" to trigger Phase 3.
- Execution results → write results to task description via update_task with <outcome>...</outcome> HTML, mark task Review.
- "Session still running, brainstorming/planning phase" → reschedule_self(minutesFromNow=5).
- "Session still running, execution phase" → reschedule_self(minutesFromNow=10). The CodingSession row already records sessionId/dir.
- Error → update_task(status: "Waiting") + send_message with the error detail.

When the user answers a question, resume the coding session with the answer. Don't write the answer into the description.

On re-execution after reschedule (no user input in between): call get_task_coding_session to resolve the latest session. If "starting", reschedule_self(2) and try again. If "ready", resume — pass sessionId, dir, and intent "execute the plan" so the gateway enters Phase 3. Only pass user answers if the user has actually replied since the last run. EXCEPTION: if the user explicitly asked for a fresh session or a different coding agent, omit sessionId.

Do NOT sleep, poll coding_read_session, or create scheduled tasks yourself — the gateway handles that.
</task_execution>`;
    } else {
      systemPrompt += `\n\n<task_context>
This conversation is about a task you're handling:
Title: ${linkedTask.title}${linkedTask.description ? `\nDescription: ${linkedTask.description}` : ""}
Task ID: ${taskHandle}
Status: ${linkedTask.status}

This IS the task — don't create or search for other tasks about this topic. If they add context, update the description via update_task (ID: ${taskHandle}).
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

    // Resolve the Watch Rules skill ID so the butler can load the user's
    // current surfacing policy via get_skill. Single source of truth: the
    // DB-backed skill. The decision agent loads the same skill on its side.
    const watchRulesSkill = await getDefaultSkill(workspaceId, "watch-rules");
    const watchRulesLoadStep = watchRulesSkill?.id
      ? `\n\n2. **Load Watch Rules and follow them.** Call \`get_skill\` with \`skill_id: "${watchRulesSkill.id}"\` and follow the directives in the returned content. Watch Rules govern TWO independent decisions for this trigger:\n   - Whether to ping the user (\`send_message\`). Use the ActionPlan's \`shouldMessage\` — \`think\` already evaluated Watch Rules to produce it.\n   - Whether to record a Live finds suggestion in today's scratchpad (\`update_scratchpad\`). These are independent — Watch Rules may call for a scratchpad write even when \`shouldMessage\` is false, and vice versa. For trigger flows, Watch Rules override anything in <capabilities> about scratchpad use.\n`
      : "";

    systemPrompt += `\n\n<trigger_context>
A trigger has fired: "${triggerContext.reminderText}"${isTriggerFollowUp ? `\nThis is a FOLLOW-UP trigger. One follow-up level is the maximum — if the issue is still unresolved, mark the task Waiting and notify the user via send_message.` : ""}${isRecurring ? `\nThis is a RECURRING task. Send results via send_message only and leave the task description untouched. The system handles the recurring lifecycle, so use Review for status changes; the next occurrence is scheduled automatically.` : ""}

**Surfacing ≠ acting on the underlying item.** A trigger is the system noticing something — your job is to *surface* it per Watch Rules (notify + scratchpad), not to take the irreversible action on the user's behalf. For an inbound customer email, that means flagging it and queuing a suggestion; do NOT draft and send a reply unless the user asked you to. Do NOT end the turn by asking the user "should I do A or B?" — make the surfacing call from Watch Rules and stop.

The \`think\` tool is your decision filter. It tells you whether to speak, what silent actions to take, and what follow-ups to queue. It does NOT compose the message — that's your job, using the skill (when one applies) and fresh data.

**Flow:**

1. Call \`think\` first. It returns an ActionPlan: \`{ shouldMessage, message: { intent, context, tone }, createFollowUps, updateTasks, silentActions, reasoning }\`.${watchRulesLoadStep}
3. If \`shouldMessage\` is true, compose and deliver the message yourself:
   a. **Pick the skill by intent.** Match the trigger's intent against the "Use when…" descriptions in \`<skills>\` and load the best fit via \`get_skill\`. If nothing fits, compose directly from the trigger text.
   b. **Gather the data the message needs.** Use \`gather_context\` / \`take_action\` for integrations, memory, web — whatever the skill's recipe (or the trigger) calls for. Fetch fresh; the ActionPlan's \`context\` carries decision flags only, not message content.
   c. **Compose** the message in the specified tone, matching the user's persona and the channel format. Keep it concise.
   d. **Deliver** via \`send_message\`. The response the user sees comes from this call — never from echoing the ActionPlan JSON.

4. If Watch Rules call for a scratchpad entry (Live finds), call \`update_scratchpad\` using the HTML structure the rules specify. Do this whether or not you also messaged.

5. If \`shouldMessage\` is false AND Watch Rules don't call for a scratchpad write, skip both — handle silently.

6. Apply \`createFollowUps\`${isTriggerFollowUp ? ` (ignore these — this trigger is itself a follow-up; the chain stops here)` : ` by calling \`create_task\` with \`isFollowUp=true\` and \`parentTaskId\` set to the triggering task's ID (these are reschedules of the existing task, not new ones)`}.

7. Apply \`updateTasks\` via \`update_task\`${isRecurring ? ` — except skip description updates and skip \`status: "Done"\` (the system loops recurring tasks automatically)` : ""}.

8. Apply \`silentActions\` (log entries, state updates).

The trigger IS already a task — use the existing taskId for any updates rather than creating a duplicate. Use \`send_message\` for delivery, never \`create_task\`. Trust the ActionPlan's \`shouldMessage\` decision — it has already evaluated the trigger.
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

  // Voice-mode blocks. Order matters — personality first (already in
  // systemPrompt from PERSONALITY()), then optional tone defaults for
  // personalities without their own voice variant, then the universal
  // spoken-mechanics rails LAST so the model overweights them.
  //
  //   personality voice  →  tone defaults (maybe)  →  spoken_mechanics
  //
  // Mechanics is appended unconditionally in voice mode — it owns the
  // hard rails (word budget, no markdown, identifier transformations)
  // that apply equally to TARS, Alfred, Hudson, or any custom voice.
  if (mode === "voice") {
    if (customPersonality) {
      // Custom personalities never define a voice variant — give them
      // the generic tone defaults so spoken delivery stays sane.
      systemPrompt += `\n\n${buildDefaultVoiceToneBlock()}`;
    } else {
      const personalityHasVoiceVariant = resolvePersonalityPrompt(
        personality as PersonalityType,
        "voice",
      ).hasVoiceVariant;
      if (!personalityHasVoiceVariant) {
        systemPrompt += `\n\n${buildDefaultVoiceToneBlock()}`;
      }
    }
    systemPrompt += `\n\n${buildSpokenMechanicsBlock()}`;
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
