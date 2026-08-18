/**
 * Background job: run one agent's turn on an existing conversation and
 * upsert the placeholder row with the result.
 *
 * Invoked by `dispatchMentions` whenever an @-mention lands. The row is
 * already reserved (status="working", agentId=targetAgentId) so this job
 * just needs to build the target agent's context, generate, and flip the
 * row to "done" (or "error").
 *
 * Canonical "assistant reply landed" hook for every agent turn — the
 * web chat's message-send endpoint enqueues one of these instead of
 * running mastra.stream() inline. Handles:
 *   - assistant row upsert (with agentId attribution + <mention> dispatch)
 *   - memory ingest (attributed to the running agent's handle, per-day session bucket)
 *   - credit deduction (respects BYOK — same rule as saveConversationResult)
 *   - token usage rollup (source="conversation" or "task_conversation")
 *   - conversation status flip back to "completed" in a finally
 *
 * Deliberately does NOT: insert a user-message row (the triggering row
 * is already in history when we run), generate a title.
 *
 * The tool surface is the same one the butler gets on this conversation,
 * built fresh via `buildAgentContext({ overrideAgentId })` so the target's
 * basePrompt renders as the system prompt.
 */

import { UserTypeEnum } from "@core/types";
import { Agent, convertMessages } from "@mastra/core/agent";
import { stepCountIs } from "ai";

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import {
  resolveDefaultChatModelId,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import {
  sliceTurnContext,
  updateConversationStatus,
  upsertConversationHistory,
} from "~/services/conversation.server";
import { buildAgentContext } from "~/services/agent/context";
import { getMastra } from "~/services/agent/mastra";
import {
  buildEpisodeBody,
  buildSessionBucketId,
} from "~/services/agent/conversation-ingest";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";
import { getUserTimezone } from "~/models/user.server";
import { deductCredits } from "~/trigger/utils/utils";
import { creditsForTokens } from "~/jobs/credit_utils";
import { isWorkspaceBYOK } from "~/services/byok.server";
import {
  pickAgentResultTokens,
  recordTokenUsage,
} from "~/services/tokenUsage.server";
import {
  generateWithRetry,
  prepareHistoryParts,
  selectModelMessages,
  type MessageEntry,
} from "~/services/agent/context-window";

export interface RunAgentTurnPayload {
  conversationId: string;
  /** The agent we're running THIS turn for. */
  agentId: string;
  /** The placeholder ConversationHistory row reserved by dispatchMentions.
   *  We upsert this same id with the final parts so the "working" state
   *  cleanly transitions to the reply in a single row. */
  placeholderRowId: string;
  /** delegationDepth stamped on the placeholder — copied here for logs
   *  and future policy hooks. The row itself is already at this depth. */
  delegationDepth: number;
}

export interface RunAgentTurnResult {
  success: boolean;
  error?: string;
}

const normalizeParts = (parts: any[] | undefined) =>
  (Array.isArray(parts) ? parts : []).filter(Boolean);
const hasNonEmptyParts = (parts: any[] | undefined) =>
  normalizeParts(parts).length > 0;

/**
 * Find the most recent user-authored text in a slice of ConversationHistory
 * rows. Used for memory ingest — we wrap this text as `<user>...</user>` so
 * recall can bind the specialist's answer back to what the user actually
 * asked. Returns "" when the trigger was purely another agent's message
 * (agent-chain case), which is fine — buildEpisodeBody skips the
 * <user> block when the text is empty.
 */
function extractLatestUserText(historyRows: any[]): string {
  for (let i = historyRows.length - 1; i >= 0; i--) {
    const row = historyRows[i];
    if (row?.userType !== "User") continue;
    const parts = normalizeParts(row.parts);
    const text = parts
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text as string)
      .join("");
    if (text.trim().length > 0) return text;
  }
  return "";
}

export async function processAgentTurn(
  payload: RunAgentTurnPayload,
): Promise<RunAgentTurnResult> {
  const { conversationId, agentId, placeholderRowId, delegationDepth } =
    payload;

  // Direct prisma read — no userId scoping guard needed inside a trusted
  // background job, and getConversationAndHistory requires a userId we
  // don't have on the payload.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, deleted: null },
    include: {
      ConversationHistory: {
        where: { deleted: null },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!conversation) {
    logger.warn("run-agent-turn: conversation gone", { conversationId });
    return { success: false, error: "conversation not found" };
  }

  const targetAgent = await prisma.agents.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      displayName: true,
      handle: true,
      status: true,
      workspaceId: true,
    },
  });

  if (!targetAgent || targetAgent.status !== "Active") {
    logger.warn("run-agent-turn: target agent inactive or missing", {
      agentId,
      conversationId,
    });
    await upsertConversationHistory(
      placeholderRowId,
      [
        {
          type: "text",
          text: `(agent is unavailable)`,
        },
      ],
      conversationId,
      UserTypeEnum.Agent,
      true,
      { status: "error", error: "agent-unavailable" },
      agentId,
    );
    return { success: false, error: "agent unavailable" };
  }

  const workspaceId = conversation.workspaceId;
  const userId = conversation.userId;
  if (!workspaceId || !userId) {
    logger.error("run-agent-turn: conversation missing workspace/user", {
      conversationId,
    });
    return { success: false, error: "conversation missing workspace/user" };
  }

  // Exclude the placeholder row from history — the target agent is about
  // to write into it, and its current "…is working…" text isn't real
  // context. Everything else (including prior turns from other agents in
  // this conversation) flows through unchanged. That's the whole point of
  // the mention model: the specialist reads the thread and picks it up.
  const historyRows = (conversation.ConversationHistory ?? []).filter(
    (h: any) => h.id !== placeholderRowId,
  );

  const liveHistory = sliceTurnContext(historyRows);

  // Resolve display names so prepareHistoryParts can prefix cross-agent
  // messages with `[Alfred] ...` etc. — mirrors buzz's per-line speaker
  // attribution while keeping AI-SDK roles intact.
  const historyAgentIds = Array.from(
    new Set(
      (liveHistory as any[])
        .map((h) => h.agentId as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const agentDisplayNames: Record<string, string> = {
    [targetAgent.id]: targetAgent.displayName,
  };
  const others = historyAgentIds.filter((id) => id !== targetAgent.id);
  if (others.length > 0) {
    const rows = await prisma.agents.findMany({
      where: { id: { in: others } },
      select: { id: true, displayName: true },
    });
    for (const r of rows) agentDisplayNames[r.id] = r.displayName;
  }

  // Role assignment per row — buzz-style: only the currently-running
  // agent's own past turns are "assistant"; every other agent's turns
  // become "user" with a `[SpeakerName] ` content prefix. Without this,
  // the model reads a teammate's reply as its own past turn and either
  // ignores the caller's context or confidently claims "I'm Cass" when
  // it's actually the generalist.
  //
  // The speaker prefix is stamped by prepareHistoryParts based on
  // `rowAgentId` vs `runningAgentId` — this file just picks the role.
  const historyMessages: MessageEntry[] = liveHistory
    .map((history: any) => {
      let role: "user" | "assistant";
      if (history.role) {
        role = history.role as "user" | "assistant";
      } else if (history.userType === "Agent") {
        role = history.agentId === agentId ? "assistant" : "user";
      } else {
        role = "user";
      }
      const normalized = normalizeParts(history.parts);
      const parts = prepareHistoryParts(role, normalized, {
        rowAgentId: history.agentId,
        runningAgentId: agentId,
        agentDisplayNames,
      });
      return { parts, role, id: history.id, createdAt: history.createdAt };
    })
    .filter((m) => hasNonEmptyParts(m.parts));

  // Two cases need a synthetic trailing user turn so we don't hand the
  // model an assistant-terminated message list (Anthropic rejects: "the
  // conversation must end with a user message"), AND to anchor the
  // model's attention on what the current wake-up is actually for:
  //
  //   1. Empty history — task chat picked up by the agent before any
  //      user turn exists. We synthesize a "work on task X" pulse.
  //   2. History ends with an assistant row — usually because a specialist
  //      just replied and this agent was auto-woken to react. We
  //      synthesize a steer that names the specific colleague and tells
  //      the running agent to build on their reply rather than restart
  //      from the top of the thread. This is the buzz-style approach:
  //      steer as user-message content, not as a system-prompt block.
  const lastRole = historyMessages[historyMessages.length - 1]?.role;
  const needsSyntheticUser =
    historyMessages.length === 0 || lastRole === "assistant";
  if (needsSyntheticUser) {
    const taskHandle = conversation.asyncJobId
      ? (
          await prisma.task
            .findUnique({
              where: { id: conversation.asyncJobId },
              select: { displayId: true, id: true },
            })
            .catch(() => null)
        )
      : null;
    const label = taskHandle
      ? (taskHandle.displayId ?? `tk-${taskHandle.id}`)
      : null;

    let triggerText: string;
    let reason: string;
    if (historyMessages.length === 0) {
      triggerText = label
        ? `Work on the task ${label}.`
        : `Please continue.`;
      reason = "empty-history";
    } else {
      // Find who authored the trailing assistant row so the steer can
      // name them specifically. Falls back to a generic "a teammate"
      // wording when we can't resolve the caller (legacy rows without
      // agentId, agent since deleted, etc.).
      const lastAgentRow = [...historyRows]
        .reverse()
        .find((h: any) => h.userType === "Agent" && h.agentId);
      const callerAgentId = lastAgentRow?.agentId as string | undefined;
      const caller = callerAgentId
        ? await prisma.agents
            .findUnique({
              where: { id: callerAgentId },
              select: { handle: true, displayName: true },
            })
            .catch(() => null)
        : null;

      const callerLabel = caller
        ? `@${caller.handle} (${caller.displayName})`
        : "a teammate";
      const taskFragment = label ? ` on task ${label}` : "";

      triggerText = [
        `${callerLabel} just replied above${taskFragment} — that reply is the reason you were woken. Read it before you do anything else.`,
        ``,
        `Rules for this turn:`,
        `- Build on what ${caller?.displayName ?? "they"} said. Do not restart the thread from the top or re-answer the original question as if the reply doesn't exist.`,
        `- If they answered part of the ask, acknowledge it and continue from there. Do not repeat their content.`,
        `- If they did work you'd otherwise redo (fetched data, opened a page, ran a tool), use their result — do not duplicate the call.`,
        `- If they asked you a question, answer that question directly.`,
        `- If they handed control back with nothing more to add, close the loop with the human or hand off explicitly via a \`<mention colleague="…" />\` tag.`,
        `- Silence ends your turn; explicit mention is the only way to route further.`,
      ].join("\n");
      reason = "assistant-tail";
    }

    logger.info("run-agent-turn: synthesizing trailing user turn", {
      conversationId,
      agentId,
      reason,
    });
    historyMessages.push({
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: triggerText }],
      createdAt: new Date(),
    } as MessageEntry);
  }

  // The last row in history is what triggered this turn. Peel it off as
  // the "current message" so `selectModelMessages` treats prior turns as
  // history and the trigger as the fresh input — mirrors noStreamProcess
  // shape so the same context-window logic applies.
  const currentMessage = historyMessages[historyMessages.length - 1];
  const priorHistory = historyMessages.slice(0, -1);

  const modelString = await resolveDefaultChatModelId(workspaceId);
  const { modelConfig } = await resolveModelConfig(modelString, workspaceId);

  const selection = await selectModelMessages({
    workspaceId,
    conversationId,
    history: priorHistory,
    currentMessage,
  });
  logger.info("run-agent-turn context selection", {
    conversationId,
    agentId,
    delegationDepth,
    mode: selection.mode,
    keptMessages: selection.stats.keptMessages,
    estimatedTokens: selection.stats.estimatedTokens,
  });

  let { systemPrompt, tools, modelMessages, gatewayAgents } =
    await buildAgentContext({
      userId,
      workspaceId,
      source: (conversation.source as any) ?? "core",
      finalMessages: selection.messages,
      conversationId,
      interactive: false,
      modelConfig,
      overrideAgentId: agentId,
    });

  // For OpenAI-compat BYOK endpoints (cliproxy, Claude Code proxies,
  // CLI-agent wrappers), the upstream agent has its own baked-in
  // system prompt / identity that will fight ours. Fold everything
  // into a single user-message "assignment brief" so the upstream
  // agent keeps its identity and treats our content as the task —
  // mirrors buzz-acp's approach and validated in prompt-lab.
  const { buildUserBrief, shouldUseUserBriefDelivery } = await import(
    "~/services/agent/user-brief-delivery"
  );
  if (shouldUseUserBriefDelivery(modelConfig)) {
    ({ systemPrompt, modelMessages } = buildUserBrief({
      systemPrompt,
      modelMessages,
    }));
    logger.info("run-agent-turn: using user-brief delivery (BYOK openai-compat)", {
      conversationId,
      agentId,
    });
  }

  const subagents: Record<string, Agent> = {};
  for (const gw of gatewayAgents) subagents[gw.id] = gw;

  const agent = new Agent({
    id: `agent-turn-${agentId}`,
    name: targetAgent.displayName,
    model: modelConfig as any,
    instructions: systemPrompt,
    agents: subagents,
  });
  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);
  for (const gw of gatewayAgents) {
    (gw as any).__registerMastra(mastra);
  }

  let result: any;
  try {
    result = await generateWithRetry({
      agent,
      modelMessages: modelMessages as unknown[],
      generateOptions: {
        toolsets: { core: tools },
        stopWhen: [stepCountIs(10)],
        modelSettings: { temperature: 0.5 },
      },
      conversationId,
    });
  } catch (error) {
    const errText = error instanceof Error ? error.message : String(error);
    logger.error("run-agent-turn generate failed", {
      error,
      agentId,
      conversationId,
    });
    await upsertConversationHistory(
      placeholderRowId,
      [
        {
          type: "text",
          text: `(${targetAgent.displayName} hit an error: ${errText})`,
        },
      ],
      conversationId,
      UserTypeEnum.Agent,
      true,
      {
        status: "error",
        error: errText,
        completedAt: new Date().toISOString(),
      },
      agentId,
    );
    return { success: false, error: errText };
  }

  const parts: any[] = [];
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  for (const step of steps) {
    if (steps.length > 1 && step !== steps[0]) {
      parts.push({ type: "step-start" });
    }
    for (const toolCall of step.toolCalls ?? []) {
      const tc = toolCall.payload ?? toolCall;
      const toolResult = (step.toolResults ?? []).find((r: any) => {
        const tr = r.payload ?? r;
        return tr.toolCallId === tc.toolCallId;
      });
      const tr = toolResult?.payload ?? toolResult;
      parts.push({
        type: `tool-${tc.toolName}`,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        state: "output-available",
        input: tc.args,
        output: tr?.result,
      });
    }
    if (step.text) {
      parts.push({ type: "text", text: step.text });
    }
  }

  if (parts.length === 0) {
    const fallback =
      typeof result?.text === "string" && result.text.length > 0
        ? result.text
        : `(${targetAgent.displayName} produced no output.)`;
    parts.push({ type: "text", text: fallback });
  }

  await upsertConversationHistory(
    placeholderRowId,
    parts,
    conversationId,
    UserTypeEnum.Agent,
    true,
    {
      status: "done",
      completedAt: new Date().toISOString(),
    },
    agentId,
  );

  // Ingest into memory attributed to this specialist. `userText` here is
  // the last non-agent text before this turn — that's what the specialist
  // was replying to. Nulled out for pure agent-chain turns where the
  // trigger was another agent, since wrapping another agent's message in
  // <user> would misattribute it.
  const responseText = parts
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text as string)
    .join("");
  if (responseText.trim().length > 0) {
    const triggeringUserText = extractLatestUserText(historyRows);
    try {
      const timezone = await getUserTimezone(userId);
      await addToQueue(
        {
          episodeBody: buildEpisodeBody({
            userText: triggeringUserText,
            agentText: responseText,
            agentHandle: targetAgent.handle,
          }),
          source: (conversation.source as any) ?? "core",
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
          sessionId: buildSessionBucketId(conversationId, timezone),
        },
        userId,
        workspaceId,
      );
    } catch (err) {
      logger.warn("run-agent-turn: memory ingest failed", {
        error: err,
        conversationId,
        agentId,
      });
    }
  }

  // Accounting: mirror what saveConversationResult does on the streaming
  // path so credits/token rollups aren't a per-endpoint concern. BYOK
  // workspaces pay their own provider bill and bypass credit deduction.
  try {
    const { inputTokens, outputTokens } = pickAgentResultTokens(result);
    const isBYOK = await isWorkspaceBYOK(workspaceId);
    if (!isBYOK) {
      const cost = creditsForTokens(inputTokens, outputTokens);
      await deductCredits(workspaceId, userId, "chatMessage", cost);
    }
    await recordTokenUsage({
      workspaceId,
      userId,
      // The task-scoped conversation flag is derived from
      // conversation.source rather than a separate signal. Matches the
      // bucketing noStreamProcess uses.
      source:
        conversation.source === "task" ? "task_conversation" : "conversation",
      inputTokens,
      outputTokens,
      model: modelString,
    });
  } catch (err) {
    logger.warn("run-agent-turn: accounting failed (non-fatal)", {
      err,
      conversationId,
      agentId,
    });
  }

  // Chain: if this specialist emitted mentions, dispatch to those
  // agents too. Depth guard in dispatchMentions caps the chain.
  const { dispatchMentions } = await import(
    "~/services/agent/dispatch-mentions"
  );
  await dispatchMentions({
    sourceRow: {
      id: placeholderRowId,
      conversationId,
      workspaceId,
      parts: parts as unknown,
      delegationDepth,
      authorAgentId: agentId,
    },
  }).catch((err) => {
    logger.error("run-agent-turn: dispatchMentions failed", {
      error: err,
      conversationId,
      agentId,
    });
  });

  // Flip the conversation status back to "completed" so the UI's
  // spinner (driven by conversation.status === "running") clears. We
  // never want a hung status if the job crashes — belt-and-suspenders
  // this is done in a try/catch even though the earlier code paths
  // either returned success or already flipped to "error".
  try {
    await updateConversationStatus(conversationId, "completed");
  } catch (err) {
    logger.warn("run-agent-turn: status flip failed (non-fatal)", {
      err,
      conversationId,
    });
  }

  return { success: true };
}
