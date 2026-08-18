import { dispatchMentions } from "./dispatch-mentions";
import { prisma } from "~/db.server";
import {
  getConversationAndHistory,
  sliceTurnContext,
  updateConversationStatus,
  upsertConversationHistory,
} from "../conversation.server";
import { EpisodeType, UserTypeEnum } from "@core/types";
import { generateId, stepCountIs } from "ai";
import { Agent, convertMessages } from "@mastra/core/agent";
import type { OutputProcessor } from "@mastra/core/processors";
import { buildAgentContext } from "./context";
import { getMastra } from "./mastra";
import { logger } from "~/services/logger.service";
import {
  resolveDefaultChatModelId,
  resolveModelConfig,
} from "~/services/llm-provider.server";
import {
  type Trigger,
  type DecisionContext,
} from "~/services/agent/types/decision-agent";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import { deductCredits, hasCredits } from "~/trigger/utils/utils";
import { creditsForTokens } from "~/jobs/credit_utils";
import { isWorkspaceBYOK } from "~/services/byok.server";
import {
  pickAgentResultTokens,
  recordTokenUsage,
} from "~/services/tokenUsage.server";
import { addToQueue } from "~/lib/ingest.server";
import {
  buildEpisodeBody,
  buildSessionBucketId,
} from "./conversation-ingest";
import { getUserTimezone } from "~/models/user.server";
import {
  selectModelMessages,
  compactSurvivedInModelMessages,
  generateWithRetry,
  describeAgentError,
  prepareHistoryParts,
  type MessageEntry,
} from "./context-window";

const normalizeParts = (parts: any[] | undefined) =>
  (Array.isArray(parts) ? parts : []).filter(Boolean);

interface NoStreamProcessBody {
  id: string;
  message?: {
    id?: string;
    parts: any[];
    role: string;
  };
  messages?: {
    id?: string;
    parts: any[];
    role: string;
  }[];
  needsApproval?: boolean;
  source: string;
  /** Override the user type for the inbound message (e.g. System for reminders) */
  messageUserType?: UserTypeEnum;
  /** Trigger context — enables think tool for non-user triggers */
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
  /** If true, the user message won't be saved to conversation history (still used as AI context) */
  skipUserMessage?: boolean;
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools;
  /** When set, adds add_comment tool for daily scratchpad responses */
  scratchpadPageId?: string;
  /** When true, write tools require user approval (default false) */
  interactive?: boolean;
}

export async function noStreamProcess(
  body: NoStreamProcessBody,
  userId: string,
  workspaceId: string,
) {
  // Pre-flight credit check. BYOK workspaces pay their own provider bills so
  // they always pass; everyone else must have credits before we invoke the
  // model. Callers catch `Error("no credits")` and surface HTTP 402. Named
  // separately from the per-model `isBYOK` returned by `resolveModelConfig`
  // further down — this one is a workspace-wide gate.
  const workspaceHasBYOK = await isWorkspaceBYOK(workspaceId);
  if (!workspaceHasBYOK) {
    const ok = await hasCredits(workspaceId, userId, "chatMessage");
    if (!ok) {
      throw new Error("no credits");
    }
  }

  const conversation = await getConversationAndHistory(body.id, userId);
  const isAssistantApproval = body.needsApproval;

  await updateConversationStatus(body.id, "running");

  const conversationHistory = conversation?.ConversationHistory ?? [];

  const messageUserType = body.messageUserType ?? UserTypeEnum.User;

  if (
    conversationHistory.length > 1 &&
    !isAssistantApproval &&
    !body.skipUserMessage
  ) {
    const messageParts = body.message?.parts;

    await upsertConversationHistory(
      body.message?.id ?? crypto.randomUUID(),
      messageParts,
      body.id,
      messageUserType,
      false,
    );
  }

  // NB: no user-side dispatchMentions here. The conversation-owning agent
  // (butler in 1:1s, assigned specialist in task chats) is always the
  // first speaker on a user turn — they can read any @mention the user
  // wrote and choose to relay via their own <mention colleague="…" /> in
  // the reply. That keeps the flow consistent whether or not the target
  // conversation supports collaboration, and dodges the "empty SSE on
  // user @X" edge case entirely.

  const normalizeParts = (parts: any[] | undefined) =>
    (Array.isArray(parts) ? parts : []).filter(Boolean);

  const hasNonEmptyParts = (parts: any[] | undefined) =>
    normalizeParts(parts).length > 0;

  // Trim to the live turn context window BEFORE building MessageEntry rows so
  // the pre-filter runs on the DB shape and downstream selectors see the
  // slice, not the full backlog. Rules: today's messages (default), fall back
  // to last MIN_LIVE_CONTEXT overall when today is sparse, hard-cap busy days
  // at MAX_LIVE_CONTEXT. Older turns stay in the DB and remain reachable via
  // memory search.
  const liveHistory = sliceTurnContext(conversationHistory);

  // Resolve display names for every agentId that appears in history so
  // prepareHistoryParts can render "[Alfred] ..." style prefixes for
  // cross-agent rows. Single query — the running agent isn't known here
  // (this codepath is butler-owned) so runningAgentId comes from the
  // conversation record below.
  const historyAgentIds = Array.from(
    new Set(
      (liveHistory as any[])
        .map((h) => h.agentId as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const agentDisplayNames: Record<string, string> = {};
  if (historyAgentIds.length > 0) {
    const rows = await prisma.agents.findMany({
      where: { id: { in: historyAgentIds } },
      select: { id: true, displayName: true },
    });
    for (const r of rows) agentDisplayNames[r.id] = r.displayName;
  }
  const conversationOwner = await prisma.conversation
    .findUnique({ where: { id: body.id }, select: { agentId: true } })
    .then((c) => c?.agentId ?? null);

  // Role assignment per row — buzz-style: only the running agent's own
  // past turns are role="assistant"; every other agent's turns get
  // demoted to role="user" with a `[SpeakerName] ` prefix (stamped by
  // prepareHistoryParts). Prevents the running agent from reading a
  // teammate's reply as its own past turn.
  const historyMessages: MessageEntry[] = liveHistory
    .map((history: any) => {
      let role: "user" | "assistant";
      if (history.role) {
        role = history.role as "user" | "assistant";
      } else if (history.userType === "Agent") {
        role =
          conversationOwner && history.agentId === conversationOwner
            ? "assistant"
            : "user";
      } else {
        role = "user";
      }
      const normalized = normalizeParts(history.parts);
      const parts = prepareHistoryParts(role, normalized, {
        rowAgentId: history.agentId,
        runningAgentId: conversationOwner,
        agentDisplayNames,
      });
      return { parts, role, id: history.id, createdAt: history.createdAt };
    })
    .filter((m) => hasNonEmptyParts(m.parts));

  const message = body.message?.parts[0].text;
  let finalMessages: MessageEntry[];
  let selectionMode: string | undefined;

  if (!isAssistantApproval) {
    const id = body.message?.id;
    const userMessageId = id ?? generateId();
    const currentMessage: MessageEntry = {
      id: userMessageId,
      role: "user",
      parts: body.message?.parts ?? [{ text: message, type: "text" }],
    };
    const selection = await selectModelMessages({
      workspaceId,
      conversationId: body.id,
      history: historyMessages,
      currentMessage,
    });
    logger.info("Agent context selection", {
      conversationId: body.id,
      mode: selection.mode,
      totalMessages: selection.stats.totalMessages,
      keptMessages: selection.stats.keptMessages,
      estimatedTokens: selection.stats.estimatedTokens,
      compactTokens: selection.stats.compactTokens,
    });
    finalMessages = selection.messages;
    selectionMode = selection.mode;
  } else {
    finalMessages = body.messages as any;
  }

  const modelString = await resolveDefaultChatModelId(workspaceId);
  const { modelConfig, isBYOK } = await resolveModelConfig(
    modelString,
    workspaceId,
  );

  let {
    systemPrompt,
    tools,
    modelMessages,
    gatewayAgents,
  } = await buildAgentContext({
    userId,
    workspaceId,
    source: body.source as any,
    finalMessages,
    triggerContext: body.triggerContext,
    onMessage: body.onMessage,
    channelMetadata: body.channelMetadata,
    conversationId: body.id,
    executorTools: body.executorTools,
    interactive: body.interactive ?? false,
    modelConfig,
    scratchpadPageId: body.scratchpadPageId,
  });

  // For OpenAI-compat BYOK endpoints (cliproxy, Claude Code proxies,
  // CLI-agent wrappers), the upstream agent's own system prompt will
  // fight ours. Fold system + history into a single user-message
  // "assignment brief" — the upstream agent keeps its identity and
  // treats our content as the task. Same trick as buzz-acp; validated
  // in prompt-lab.
  const { buildUserBrief, shouldUseUserBriefDelivery } = await import(
    "~/services/agent/user-brief-delivery"
  );
  if (shouldUseUserBriefDelivery(modelConfig)) {
    ({ systemPrompt, modelMessages } = buildUserBrief({
      systemPrompt,
      modelMessages,
    }));
    logger.info("no-stream-process: using user-brief delivery (BYOK openai-compat)", {
      conversationId: body.id,
    });
  }

  // Delivery invariant: in compact+recent mode the compact summary MUST reach
  // the model — it is the agent's only view of everything older than the recent
  // window. If a converter/provider change ever drops it, surface it loudly
  // instead of silently losing context and re-asking.
  if (selectionMode === "compact+recent") {
    const compactPresent = compactSurvivedInModelMessages(
      modelMessages as any[],
    );
    if (!compactPresent) {
      logger.error("Compact summary missing from model messages", {
        conversationId: body.id,
        mode: selectionMode,
        modelMessageCount: (modelMessages as any[]).length,
      });
    }
  }

  // Main agent's sub-agents are only the gateway-backed ones now — every
  // other tool the main agent needs (memory search, integrations, tasks,
  // skills, etc.) lives directly on the main agent's `tools` map. Gateway
  // agents remain sub-agents because each wraps a remote gateway with its
  // own manifest-driven tool set.
  const subagents: Record<string, Agent> = {};
  for (const gw of gatewayAgents) {
    subagents[gw.id] = gw;
  }

  const agent = new Agent({
    id: "core-agent",
    name: "Core Agent",
    model: modelConfig as any,
    instructions: systemPrompt,
    agents: subagents,
  });

  // Wire Mastra for storage on all agent levels
  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);
  for (const gw of gatewayAgents) {
    (gw as any).__registerMastra(mastra);
  }

  // Capture final parts/text from outputProcessor for channel reply
  let capturedParts: any[] = [];
  let capturedText = "";

  const messageHistoryProcessor: OutputProcessor = {
    id: "message-history",
    async processInput({ messages }: any) {
      return messages;
    },
    async processOutputResult({ messages }: any) {
      const converted = convertMessages(messages).to("AIV6.UI") as any[];
      const lastMsg = converted[converted.length - 1];
      capturedParts = lastMsg?.parts ?? [];
      capturedText = capturedParts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      return messages;
    },
  };

  let agentResult: any;
  try {
    agentResult = await generateWithRetry({
      agent,
      modelMessages: modelMessages as unknown[],
      generateOptions: {
        toolsets: { core: tools },
        stopWhen: [stepCountIs(10)],
        modelSettings: { temperature: 0.5 },
        outputProcessors: [messageHistoryProcessor],
      },
      conversationId: body.id,
    });
  } catch (error) {
    // The agent blew up mid-generate (context overflow, provider timeout, etc.).
    // generateWithRetry already tried to recover from context-length errors by
    // dropping rounds; reaching this catch means that didn't work or the error
    // was of a different kind. Persist a graceful assistant message so the
    // user sees something instead of a silent drop, then mark the conversation
    // failed so status is accurate.
    const { kind, userMessage } = describeAgentError(error);
    logger.warn(
      "Agent generate failed after retries, posting fallback message",
      {
        conversationId: body.id,
        kind,
        error: error instanceof Error ? error.message : String(error),
        historyLength: conversationHistory.length,
      },
    );

    const fallbackMessageId = crypto.randomUUID();
    const fallbackParts = [{ type: "text", text: userMessage }];
    try {
      await upsertConversationHistory(
        fallbackMessageId,
        fallbackParts,
        body.id,
        UserTypeEnum.Agent,
        false,
      );
    } catch (persistError) {
      logger.error("Failed to persist fallback assistant message", {
        conversationId: body.id,
        error:
          persistError instanceof Error
            ? persistError.message
            : String(persistError),
      });
    }
    await updateConversationStatus(body.id, "failed");

    return {
      id: fallbackMessageId,
      role: "assistant",
      parts: fallbackParts,
      text: userMessage,
    };
  }

  // Build assistant parts from result.steps (handle Mastra payload wrapper)
  const assistantMessageId = crypto.randomUUID();
  const assistantParts: any[] = [];

  for (const step of agentResult.steps) {
    if (agentResult.steps.length > 1 && step !== agentResult.steps[0]) {
      assistantParts.push({ type: "step-start" });
    }

    for (const toolCall of step.toolCalls ?? []) {
      const tc = toolCall.payload ?? toolCall;
      const toolResult = (step.toolResults ?? []).find((r: any) => {
        const tr = r.payload ?? r;
        return tr.toolCallId === tc.toolCallId;
      });
      const tr = toolResult?.payload ?? toolResult;
      assistantParts.push({
        type: `tool-${tc.toolName}`,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        state: "output-available",
        input: tc.args,
        output: tr?.result,
      });
    }

    if (step.text) {
      assistantParts.push({ type: "text", text: step.text });
    }
  }

  const assistantMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: assistantParts,
  };

  // Attribute the main agent's reply to the conversation's owning agent
  // so multi-agent threads render correctly (and so dispatchMentions'
  // self-mention guard has an author to check against).
  const owningAgentId = await prisma.conversation
    .findUnique({
      where: { id: body.id },
      select: { agentId: true },
    })
    .then((c) => c?.agentId ?? null);

  try {
    await upsertConversationHistory(
      assistantMessageId,
      assistantParts,
      body.id,
      UserTypeEnum.Agent,
      false,
      undefined,
      owningAgentId,
    );

    // If the assistant emitted <mention colleague="…" /> tags, spin up
    // specialist turns on this conversation. The main agent's row is
    // depth 0 (it's a direct reply to the user); mention chains grow from
    // there. Skipped if a triggerContext is present since scheduled task
    // triggers shouldn't fan out to specialists mid-run.
    if (!body.triggerContext) {
      await dispatchMentions({
        sourceRow: {
          id: assistantMessageId,
          conversationId: body.id,
          workspaceId,
          parts: assistantParts as unknown,
          delegationDepth: 0,
          authorAgentId: owningAgentId,
        },
      }).catch((err) => {
        logger.error("noStreamProcess: dispatchMentions failed", {
          error: err,
          conversationId: body.id,
        });
      });
    }

    if (agentResult.text) {
      // Resolve owning agent's handle for the episode's <agent> attribution.
      // If the conversation has no agentId (edge case) we fall back to
      // "agent" inside buildEpisodeBody. Same DB read below could be
      // reused across multi-ingest paths — small enough to leave.
      const owningAgentHandle = owningAgentId
        ? await prisma.agents
            .findUnique({
              where: { id: owningAgentId },
              select: { handle: true },
            })
            .then((a) => a?.handle ?? null)
        : null;

      // Per-day session bucket so long-running conversations don't compact
      // into one giant blob and recall can slice by day.
      const timezone = await getUserTimezone(userId);
      const sessionId = buildSessionBucketId(body.id, timezone);

      await addToQueue(
        {
          episodeBody: buildEpisodeBody({
            userText: message,
            agentText: agentResult.text,
            agentHandle: owningAgentHandle,
          }),
          source: body.source,
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
          sessionId,
        },
        userId,
        workspaceId,
      );
    }

    // Roll up real LLM token usage. Trigger flows (reminders, task triggers)
    // set body.triggerContext — track those separately from user chat so the
    // daily rollup breaks out task_conversation vs conversation.
    const { inputTokens, outputTokens } = pickAgentResultTokens(agentResult);

    // Charge from real token usage. Prior code deducted a flat 1 credit per
    // turn regardless of how many tokens the agent burned across tool loops;
    // now a heavy multi-step turn costs proportionally more. BYOK workspaces
    // still bypass — they pay their own provider bills.
    if (!isBYOK) {
      const chatCredits = creditsForTokens(inputTokens, outputTokens);
      await deductCredits(workspaceId, userId, "chatMessage", chatCredits);
    }

    await recordTokenUsage({
      workspaceId,
      userId,
      source: body.triggerContext ? "task_conversation" : "conversation",
      inputTokens,
      outputTokens,
      model: modelString,
    });
  } finally {
    await updateConversationStatus(body.id, "completed");
  }

  return { ...assistantMessage, text: agentResult.text };

  // const uiStream = createUIStreamWithApprovals(agentResult);
  // const sseStream = uiStream.pipeThrough(new JsonToSseTransformStream());
  // const streamId = generateId();
  // await setActiveStreamId(body.id, streamId);

  // try {
  //   const ctx = getResumableStreamContext();
  //   const resumable = await ctx.createNewResumableStream(
  //     streamId,
  //     () => sseStream,
  //   );
  //   if (resumable) {
  //     const reader = resumable.getReader();
  //     while (true) {
  //       const { done } = await reader.read();
  //       if (done) break;
  //     }
  //     reader.releaseLock();
  //   }
  // } catch (error) {
  //   await updateConversationStatus(body.id, "failed");
  //   throw error;
  // } finally {
  //   await clearActiveStreamId(body.id);
  // }

  // return {
  //   id: crypto.randomUUID(),
  //   role: "assistant",
  //   parts: capturedParts,
  //   text: capturedText,
  // };
}
