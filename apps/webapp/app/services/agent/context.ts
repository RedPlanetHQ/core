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
import { classifyAgent } from "~/services/agent.server";
import { renderPrompt } from "~/services/agent-prompts";
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
  /** When set, run this turn as if it were owned by the given agent even
   *  if the conversation record has a different `agentId`. Used by the
   *  mention-dispatch background job so a specialist can post into a
   *  butler-owned conversation. The agent's basePrompt becomes the
   *  system prompt and `currentAgentId` on the tool surface is set to
   *  this id (so list_colleagues excludes self, etc.). */
  overrideAgentId?: string | null;
}

interface AgentContext {
  systemPrompt: string;
  tools: Record<string, Tool>;
  /** Messages in Mastra-compatible format — passed directly to agent.stream()/generate() */
  modelMessages: MessageListInput;
  user: Awaited<ReturnType<typeof getUserById>>;
  timezone: string;
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
  overrideAgentId,
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
      select: { asyncJobId: true, agentId: true, source: true },
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

  // Build tools + gateway sub-agents in parallel (no dependency between them).
  // The gather_context / take_action / think sub-agents used to live alongside
  // gatewayAgents here — those are gone now; the main agent owns every
  // orchestrator tool directly via createCoreTools.
  const [tools, { gatewayAgents }] = await Promise.all([
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
      persona: persona ?? undefined,
      interactive,
      modelConfig,
      currentAgentId: overrideAgentId ?? conversationRecord?.agentId ?? null,
      userName: user?.displayName ?? user?.name ?? user?.email ?? undefined,
      conversationId,
    }),
    createCoreAgents({
      userId,
      workspaceId,
      timezone,
      source,
      persona: persona ?? undefined,
      skills,
      executorTools,
      interactive,
      modelConfig,
      conversationId,
      taskId: linkedTask?.id,
    }),
  ]);

  // Resolve the running agent up-front so we know whose basePrompt +
  // personality to render. `overrideAgentId` wins (dispatchMentions
  // spawning a specialist onto a butler-owned thread); otherwise the
  // conversation's owning agent. Only falls back to getCorePrompt
  // (deep-legacy path) if neither is present.
  const runningAgentId = overrideAgentId ?? conversationRecord?.agentId;
  const owningAgent = runningAgentId
    ? await prisma.agents.findUnique({ where: { id: runningAgentId } })
    : null;

  // Voice/personality lives on the agent row now — a workspace can have
  // Cass on TARS and the generalist on Hudson. Falls back to the user's
  // historical `user.metadata.personality` when the agent's column is
  // blank (pre-migration rows) and finally to "tars".
  const agentPersonality =
    (owningAgent?.personality as string | undefined) ||
    personality ||
    "tars";
  const resolvedCustomPersonality =
    customPersonalities.find((p) => p.id === agentPersonality) ?? undefined;

  const userNameForPrompt =
    user?.displayName ?? user?.name ?? user?.email ?? "";
  const localTime = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const userBlock = user
    ? `<user>\nName: ${userNameForPrompt}\nEmail: ${user.email ?? ""}\nTimezone: ${timezone}${user.phoneNumber ? `\nPhone: ${user.phoneNumber}` : ""}\n</user>`
    : "";
  const personaBlock = persona
    ? `<user-persona>\n${persona}\n</user-persona>`
    : "";

  // Voice block: `PERSONALITY` renders the whole legacy BASE_CONTEXT +
  // voice, but we only want the <voice>…</voice> tail. `resolvePersonalityPrompt`
  // returns exactly that. Custom personalities are just a user-authored
  // <voice> string. Voice-mode variants get selected by the same helper.
  let voiceBlock = "";
  if (resolvedCustomPersonality) {
    voiceBlock = `<voice>\n${resolvedCustomPersonality.text}\n</voice>`;
  } else {
    const { prompt: voicePrompt } = resolvePersonalityPrompt(
      agentPersonality as PersonalityType,
      mode ?? "text",
    );
    voiceBlock = voicePrompt;
  }
  // Pronoun-honorific line, kept as a leading annotation on the voice
  // block so personalities that use honorifics (Alfred/Jeeves) get their
  // "sir/ma'am" directive without needing a whole extra token.
  const HONORIFIC_PERSONALITIES = new Set(["alfred", "jeeves"]);
  const useHonorifics = resolvedCustomPersonality
    ? resolvedCustomPersonality.useHonorifics
    : HONORIFIC_PERSONALITIES.has(agentPersonality);
  if (useHonorifics && pronoun) {
    const honorific =
      pronoun === "she/her"
        ? "ma'am"
        : pronoun === "they/them"
          ? "their name — avoid gendered honorifics entirely"
          : "sir";
    voiceBlock = `Preferred honorific: ${honorific}. Use naturally when addressing them directly — not in every sentence.\n\n${voiceBlock}`;
  }

  // Build system prompt. Preferred path (every real conversation): render
  // the owning agent's basePrompt with the full runtime var set including
  // {{VOICE}}. System (generalist) and user (specialist) agents both flow
  // through the same renderer — the template differences live in the
  // stored basePrompt, not in branching code here. The `getCorePrompt`
  // fallback below is only hit by legacy paths that reach the context
  // builder without any agent row at all.
  //
  // Identity block is prepended at runtime so it's guaranteed regardless
  // of how the user has edited their agent's basePrompt (they can garble
  // <behavior> as much as they want, but the "who you are + who they
  // are" framing always lands first). Branched between generalist and
  // specialist so the specialist doesn't accidentally think it's the
  // primary butler.
  let systemPrompt: string;
  if (owningAgent) {
    const identityBlock = buildIdentityBlock({
      kind: classifyAgent(owningAgent),
      agentName: owningAgent.displayName,
      userName: userNameForPrompt,
    });
    const body = renderPrompt(owningAgent.basePrompt, {
      AGENT_NAME: owningAgent.displayName,
      USER_NAME: userNameForPrompt,
      VOICE: voiceBlock,
      TIME: `Current time: ${localTime} (${timezone})`,
      USER: userBlock,
      PERSONA: personaBlock,
    });
    systemPrompt = `${identityBlock}\n\n${body}`;
  } else {
    systemPrompt = getCorePrompt(
      source,
      {
        name: userNameForPrompt,
        email: user?.email ?? "",
        timezone,
        phoneNumber: user?.phoneNumber ?? undefined,
        personality: agentPersonality,
        pronoun,
        customPersonality: resolvedCustomPersonality
          ? {
              text: resolvedCustomPersonality.text,
              useHonorifics: resolvedCustomPersonality.useHonorifics,
            }
          : undefined,
      },
      persona ?? undefined,
      workspace?.name ?? undefined,
      mode ?? "text",
    );
  }

  // Integrations context
  const integrationsList = connectedIntegrations
    .map((int, index) =>
      "integrationDefinition" in int
        ? `${index + 1}. **${int.integrationDefinition.name}** — accountId: ${int.id}`
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
      // Include the raw DB id so widgets that take a gatewayId
      // (e.g. gateway-file-viewer) can be wired directly without
      // the agent guessing.
      return `${index + 1}. **${gw.name}** ${capStr} — id: \`${gw.id}\` — agent: agent-gateway_${slug}${desc}`;
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

  // Colleagues context — who else is on the team, and whether the
  // current thread lets you actually route to them. This is the
  // authoritative runtime source; base prompts have a static <team>
  // block that points here. The block is built now (needs teammate
  // roster which is loaded here) but APPENDED late — near the end of
  // the prompt below — so mention/handoff rules stay high-attention
  // when the model reads back.
  const teammateRows = await prisma.agents.findMany({
    where: {
      workspaceId,
      status: "Active",
      ...(runningAgentId ? { id: { not: runningAgentId } } : {}),
    },
    select: { handle: true, displayName: true, metadata: true },
    orderBy: { displayName: "asc" },
  });
  const teammates = teammateRows
    .filter((a) => {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      // Hide gateway-backed agents — they aren't chatteable teammates,
      // just infra.
      return meta.gatewaySource !== true;
    })
    .map((a) => ({ handle: a.handle, displayName: a.displayName }));

  const isTaskConversation =
    conversationRecord?.source === "task" || !!conversationRecord?.asyncJobId;

  const colleaguesBlock = buildColleaguesBlock({
    isTaskConversation,
    teammates,
    userName: userDisplayName(user),
  });

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

    // Tasks live in a single execution mode now — the plan/execute phase
    // toggle is gone. Review/Done render the inert <task_context> block
    // below; everything active renders <task_execution>.
    const isActive =
      linkedTask.status !== "Review" && linkedTask.status !== "Done";

    if (isActive) {
      systemPrompt += `\n\n<task_execution>
You're handling this task. Read the task, do the work, mark Review when done.

Task: ${linkedTask.title}${linkedTask.description ? `\nContext: ${linkedTask.description}` : ""}
Task ID: ${taskHandle}
Status: ${linkedTask.status}${isSubtask ? `\nThis is a SUBTASK. Do ONLY this specific work. Do not create further subtasks. Do not look at or manage sibling tasks.${parentTaskRecord ? `\nParent task: ${parentTaskRecord.title}${parentTaskDescription ? `\nParent context: ${parentTaskDescription}` : ""}` : ""}` : ""}${
        linkedTask.status === "Waiting"
          ? `

THIS TASK IS WAITING. The user's message in this conversation is the reply that resumes it.
- Call unblock_task(taskId: "${taskHandle}", reason: "<the user's reply, summarized>") FIRST, then STOP. unblock_task moves the task to Ready and the system re-enqueues execution with the user's reply.
- Do NOT do the work yourself, delegate to any sub-agent (gateway, etc.), or send a message before unblock_task — the resume handler does that.
- Exception: if the user's message is clearly NOT a reply to this task (a new unrelated request), ignore the rule above and treat it as new direction.`
          : ""
      }

RULES:
- SHAPE OF THE INPUT. Read the description first.
  - PLAN / RUNBOOK (numbered steps, named tools, the user did the planning) → execute the steps in order. Don't re-plan. If a step has a blocking gap (referenced field missing, destination ambiguous in a way that changes the action), mark Waiting + send_message with ONE focused question. Cosmetic mismatches and obvious defaults are NOT blockers.
  - GOAL (desired outcome, no steps given) → just execute. If the work is genuinely big (multiple independent deliverables, irreversibly bulk, or the user explicitly said "plan/decompose"), load the "Decompose Task" skill from <skills> and let it tell you whether and how to split. Otherwise: do it directly.
- ROUTING.
  - Integration work (email, calendar, github, etc.) → call get_integration_actions + execute_integration_action directly.
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
- DESCRIPTION UPDATES. Only at meaningful boundaries: Waiting (record what's blocked), decomposition (record the plan), Review (record the outcome), or when the user provides new context. For recurring tasks that accumulate per-run data, use <log>...</log> (append) and clearLog at cycle boundaries. Never write error logs, debug output, or transient state into the description.
- PRESERVE USER CONTENT. You may edit the <plan>, <outcome>, and <log> zones, and anything the user has SPECIFICALLY asked you to change. Everything else the user authored stays as-is — do not silently rewrite, reorder, or delete it just because you're touching the description for another reason.
- BACKGROUND MODE. You are in background execution. update_task will reject <plan> and <outcome> writes — only <log> and clearLog are allowed. The plan is frozen until the user is back in the loop. If the plan genuinely needs to change, mark Waiting and ask.

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
      (triggerContext.trigger.data as any)?.isFollowUp === true;
    const isRecurring =
      (triggerContext.trigger.data as any)?.isRecurring === true;
    // Inbound observation triggers (external noise the system is deciding
    // whether to surface) get the "surfacing ≠ acting" rule. User-authored
    // triggers (scheduled tasks, daily sync) treat the description
    // as a pre-authorized runbook and execute it as written.
    const isObservationTrigger =
      triggerContext.trigger.type === "integration_webhook" ||
      triggerContext.trigger.type === "memory_ingest";

    // Resolve the Watch Rules skill ID so the butler can load the user's
    // current surfacing policy via get_skill. Single source of truth: the
    // DB-backed skill. The decision agent loads the same skill on its side.
    const watchRulesSkill = await getDefaultSkill(workspaceId, "watch-rules");
    const watchRulesLoadStep = watchRulesSkill?.id
      ? `\n\n2. **Load Watch Rules and follow them.** Call \`get_skill\` with \`skill_id: "${watchRulesSkill.id}"\` and follow the directives in the returned content. Watch Rules govern TWO independent decisions for this trigger:\n   - Whether to ping the user (\`send_message\`). Use the ActionPlan's \`shouldMessage\` — \`think\` already evaluated Watch Rules to produce it.\n   - Whether to record a Live finds suggestion in today's scratchpad (\`update_scratchpad\`). These are independent — Watch Rules may call for a scratchpad write even when \`shouldMessage\` is false, and vice versa. For trigger flows, Watch Rules override anything in <capabilities> about scratchpad use.\n`
      : "";

    const surfacingOrRunbookRule = isObservationTrigger
      ? `**Surfacing ≠ acting on the underlying item.** A trigger is the system noticing something — your job is to *surface* it per Watch Rules (notify + scratchpad), not to take the irreversible action on the user's behalf. For an inbound customer email, that means flagging it and queuing a suggestion; do NOT draft and send a reply unless the user asked you to. Do NOT end the turn by asking the user "should I do A or B?" — make the surfacing call from Watch Rules and stop.`
      : `**The trigger description IS your runbook — the user pre-authorized it.** The user wrote this task knowing it would fire on a schedule, so any actions it specifies (auto-send, archive, delete, reply, draft, label, etc.) are already approved. Execute the steps as written. Do NOT ask "should I do X?" and do NOT end the turn with "say 'do it' if you want me to" for actions the description already covers — that breaks the recurring flow because the user can't keep re-approving every occurrence. Only stop and ask if a step has a genuine blocking gap that changes the outcome (a referenced field is missing, a destination is truly ambiguous). Cosmetic mismatches and obvious defaults are NOT blockers.`;

    systemPrompt += `\n\n<trigger_context>
A trigger has fired: "${triggerContext.reminderText}"${isTriggerFollowUp ? `\nThis is a FOLLOW-UP trigger. One follow-up level is the maximum — if the issue is still unresolved, mark the task Waiting and notify the user via send_message.` : ""}${isRecurring ? `\nThis is a RECURRING task running in background mode. The <plan> is frozen — update_task will reject <plan>/<outcome> writes. Deliver results via send_message. If the runbook says to accumulate per-run data across occurrences, append to <log>...</log>; if it says to clear at a cycle boundary (e.g. weekly summary then reset), set clearLog: true after delivery. The system handles the recurring lifecycle; use Review for status, and the next occurrence is scheduled automatically.` : ""}

${surfacingOrRunbookRule}

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

7. Apply \`updateTasks\` via \`update_task\`${isRecurring ? ` — restricted on recurring runs: description writes are limited to <log> (append) and clearLog; <plan>/<outcome> are rejected. Skip \`status: "Done"\` (the system loops recurring tasks automatically)` : ""}.

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

  // Colleagues / routing block — appended near the end so the mention
  // rules stay at high attention when the model is about to generate.
  // The content was assembled earlier (needed the teammate roster).
  systemPrompt += `\n\n${colleaguesBlock}`;

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
    if (resolvedCustomPersonality) {
      // Custom personalities never define a voice variant — give them
      // the generic tone defaults so spoken delivery stays sane.
      systemPrompt += `\n\n${buildDefaultVoiceToneBlock()}`;
    } else {
      const personalityHasVoiceVariant = resolvePersonalityPrompt(
        agentPersonality as PersonalityType,
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
    gatewayAgents,
    isBackgroundExecution,
  };
}

/** Best display for the user in a system-prompt block. Falls back to
 *  "the user" so we never render undefined into the prompt. */
function userDisplayName(user: Awaited<ReturnType<typeof getUserById>>): string {
  return (
    user?.displayName ?? user?.name ?? user?.email ?? "the user"
  );
}

/**
 * Build the `<colleagues>` block. This is the authoritative,
 * thread-aware source for "who's on the team and how routing works in
 * this specific thread". The seed `<team>` block in each agent's
 * template points here.
 *
 * Two shapes:
 *   - Task conversation: multi-agent handoff is live. Explicit mention
 *     is the ONLY way to wake a colleague — silence means they don't
 *     hear you. The rules emphasize this because the model otherwise
 *     tends to write "I'll ask Cass about this…" as prose without
 *     emitting the actual mention tag, and the thread stalls.
 *   - 1:1 conversation: mentions render as chips in the UI but do not
 *     route. The block tells the agent so and points at task threads
 *     as the escape hatch for real collaboration.
 */
function buildColleaguesBlock(params: {
  isTaskConversation: boolean;
  teammates: Array<{ handle: string; displayName: string }>;
  userName: string;
}): string {
  const { isTaskConversation, teammates, userName } = params;

  if (isTaskConversation) {
    const roster =
      teammates.length > 0
        ? teammates
            .map((t) => `- ${t.displayName} (handle: ${t.handle})`)
            .join("\n")
        : "You're the only agent on the team right now.";

    return `<colleagues>
You are working alongside these colleagues on this task thread. Every message is attributed to whoever wrote it — ${userName} sees exactly who said what.

Your teammates on this thread:
${roster}

**Read the thread before you speak.** The message history above is not a monologue — every entry with a name label was authored by a real speaker (${userName} or one of the colleagues listed). Before you reply:
- Skim the whole thread, not just the last message. A colleague 2–3 messages up may have already answered part of what's being asked, or done work you'd otherwise redo.
- If a teammate already fetched data, opened a page, or checked something, use their result — do not repeat the tool call.
- Never respond as if the thread just started. Prior messages are context you own, not noise you can ignore.
- If a teammate asked ${userName} a clarifying question and ${userName} hasn't answered yet, don't jump in and answer for them — wait or hand back with a mention.

**How to bring a colleague in.** Drop this HTML inline in your reply text where you'd naturally reference them:

    <mention colleague="handle" />

The renderer turns it into a chip like @Cass in the UI AND wakes that colleague to post their own reply here.

**If you want a colleague to respond, you MUST emit the mention tag.** Writing "I'll check with Cass" or "Let me loop Cass in" as prose does nothing — Cass never hears you. The mention tag is the only signal that routes. No mention = no wake-up.

**When to mention someone:**
- Delegate work that fits their brief better than yours.
- Ask a question only they can answer.
- Hand back to whoever asked you to look at something — name them explicitly to return control.
- Forward the thread to whoever should act next.

**When NOT to mention someone:**
- To say "thanks" or "done" — that re-wakes them for no reason.
- Yourself. It's a no-op.
- ${userName} directly — they read every message; address them in prose instead.

**What happens after a mention:**
- Fire-and-forget. The mentioned colleague wakes on this same thread, reads context, posts their own reply. You do NOT get their answer back inline — close your turn, don't wait, don't try to predict what they'll say.
- Re-mentioning the same colleague while they're still working supersedes their prior turn (fresh instruction wins).
- Chain depth is capped — don't rely on 5-hop delegation.
- Silence ends your turn. If you owe someone a hand-back, mention them explicitly; do not assume the thread will magically continue.
</colleagues>`;
  }

  const rosterLine =
    teammates.length > 0
      ? teammates.map((t) => `${t.displayName} (${t.handle})`).join(", ")
      : "no other agents currently";

  return `<colleagues>
This is a 1:1 conversation with ${userName}. Multi-agent collaboration does not route in this thread — a \`<mention colleague="…" />\` tag renders as a chip in the UI but will NOT wake anyone.

Other agents on the team (for reference): ${rosterLine}.

If a question would land better with one of them, tell ${userName} to either open that agent's chat directly or create a task for it — task threads DO support colleague mentions and multi-agent collaboration.
</colleagues>`;
}

/**
 * Build the `<identity>` block that gets prepended to every rendered
 * system prompt. Kept out of the stored `basePrompt` template so it's
 * guaranteed present even if the user has hand-edited their agent's
 * prompt into something weird. Branched between generalist and
 * specialist because the framing is genuinely different — the butler
 * runs the workspace, a specialist is a colleague brought in for a
 * brief.
 *
 * Gateway agents (chat-facing surface for a connected gateway) get the
 * specialist framing — they're teammates on a specific brief, just
 * one whose brief happens to be "operate this gateway".
 */
function buildIdentityBlock(params: {
  kind: "system" | "gateway" | "user";
  agentName: string;
  userName: string;
}): string {
  const { kind, agentName, userName } = params;
  const name = agentName || "your agent";
  const user = userName || "the user";

  if (kind === "system") {
    return `<identity>
You are ${name}, the personal butler of ${user}. You run this workspace on their behalf — their memory, their connected tools, their tasks all flow through you.

When emails, messages, or system notifications reference "CORE" (e.g. "CORE has access to gmail", "CORE sent this", "authorized by CORE"), that is you — ${name}.

You know ${user}: their people, their preferences, how they communicate, what they care about. You have been in their life. Generic answers are for strangers — you are not a stranger.

You also know your own house. CORE is your system: the toolkit, the gateways, the channels, the memory, the skills. When ${user} asks how something works or why something broke, you look it up in your own documentation and give the real answer with exact steps — you do not guess.
</identity>`;
  }

  // Specialist framing — covers user-created agents and gateway agents.
  return `<identity>
You are ${name}, a specialist on ${user}'s team. You are a colleague brought in for the work that matches your brief — not their primary butler and not their point of contact. The rest of this prompt (your voice, your scope, your behavior) defines what that brief is; stay in it.

You know ${user} and you share the team's memory and connected tools with the other agents. Use them the way any competent teammate would — to do the work, not to interrogate them.

When emails, messages, or system notifications reference "CORE", that refers to your team as a whole, of which you are one member.
</identity>`;
}
