/**
 * Agent context window management.
 *
 * Decides which history messages to send the model each turn, wraps
 * agent.generate with a context-length retry, and classifies errors into
 * user-facing messages.
 *
 * Consumes (does not generate) the compact summary stored at
 * prisma.document where sessionId = conversation.id.
 */

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { countTokens } from "~/services/search/tokenBudget";
import type { Agent } from "@mastra/core/agent";

// ─── Public types ───────────────────────────────────────────────────

export interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface MessageEntry {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  /**
   * When the message was created (ConversationHistory.createdAt). Optional —
   * used to bridge the compact's coverage watermark to the verbatim tail. When
   * absent, selection falls back to the fixed recent window.
   */
  createdAt?: string | Date;
}

/**
 * Trim assistant-role history parts before sending them back to the model.
 *
 * Keeps direct tool calls intact so the agent remembers what it actually did
 * last turn (otherwise it has been observed denying its own tool calls — e.g.
 * calling `create_skill` then claiming it never ran). Collapses sub-agent
 * tool calls (`tool-agent-*`) to drop their inlined `subAgentToolResults`
 * trace, since the parent has already synthesized whatever mattered into the
 * following text part and carrying the full sub-agent trace forward bloats
 * context turn after turn.
 */
export function prepareHistoryParts(
  role: "user" | "assistant" | "system",
  parts: MessagePart[],
): MessagePart[] {
  if (role !== "assistant") return parts;
  return parts.map((p) => {
    if (typeof p.type === "string" && p.type.startsWith("tool-agent-")) {
      const output = (p as { output?: { text?: unknown } }).output ?? {};
      const text = typeof output.text === "string" ? output.text : "";
      return { ...p, output: { text } };
    }
    return p;
  });
}

export type SelectionMode = "full" | "compact+recent" | "budget-trim";

export interface SelectionResult {
  messages: MessageEntry[];
  mode: SelectionMode;
  stats: {
    totalMessages: number;
    keptMessages: number;
    estimatedTokens: number;
    compactTokens: number | null;
    /** Compact coverage watermark (ISO) when known — observability for #2. */
    coveredUntil?: string | null;
  };
}

export type AgentErrorKind =
  | "context-length"
  | "timeout"
  | "rate-limit"
  | "other";

export interface AgentErrorDescription {
  kind: AgentErrorKind;
  userMessage: string;
}

// ─── Constants ──────────────────────────────────────────────────────

/** History length at which we switch from full-history to compact+recent or budget-trim. */
export const COMPACTION_TRIGGER_THRESHOLD = 10;

/** Number of recent messages kept verbatim when compact+recent is active. */
export const RECENT_MESSAGE_WINDOW = 10;

/** Token budget for budget-trim fallback (when no compact doc exists). */
export const BUDGET_TRIM_TOKENS = 40_000;

/** Fixed token cost per image/file part (tokenizer is text-only). */
export const IMAGE_TOKEN_COST = 1500;

/** Max retries on context-length errors inside generateWithRetry. */
export const CONTEXT_RETRY_MAX = 2;

/**
 * Header prepended to the compact summary when it is injected into the prompt.
 * Exported so the delivery invariant (compactSurvivedInModelMessages) and the
 * retry-path pin (dropOldestRound) can recognise the compact AFTER it has been
 * through convertMessages — its `id` is lost in that conversion, but this
 * marker text survives.
 */
export const COMPACT_PROMPT_MARKER = "Earlier in this conversation";

// ─── Token estimation ───────────────────────────────────────────────

/**
 * Above this char length we skip the tokenizer and use a chars/4 heuristic.
 * The tokenizer is O(n) with a high constant factor — calling it on very
 * long texts (e.g., pasted logs) dominates the turn's latency, and for
 * trimming purposes chars/4 is accurate enough.
 */
const TOKENIZER_CHAR_LIMIT = 20_000;

/**
 * Estimate token count for a single message. Uses gpt-tokenizer for text
 * (o200k encoding — close enough for Claude and GPT), plus a fixed
 * IMAGE_TOKEN_COST for each image/file part. On tokenizer failure for a
 * given part, falls back to chars/4. For very long text parts, skips the
 * tokenizer and uses chars/4 directly.
 */
export function estimateMessageTokens(message: MessageEntry): number {
  let total = 0;
  for (const part of message.parts ?? []) {
    if (part.type === "text" && typeof part.text === "string") {
      if (part.text.length > TOKENIZER_CHAR_LIMIT) {
        total += Math.ceil(part.text.length / 4);
        continue;
      }
      try {
        total += countTokens(part.text);
      } catch {
        total += Math.ceil(part.text.length / 4);
      }
    } else if (part.type === "file" || part.type === "image") {
      total += IMAGE_TOKEN_COST;
    }
  }
  return total;
}

/**
 * Read the compact's coverage watermark from Document.metadata — the max
 * episode validAt folded into the summary at the last compaction, written by
 * session-compaction. Returns epoch ms, or null if absent/unparseable (e.g.
 * documents compacted before #2 shipped), in which case selection falls back to
 * the fixed recent window.
 */
export function parseCoveredUntil(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).coveredUntil;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function selectModelMessages(params: {
  workspaceId: string;
  conversationId: string;
  history: MessageEntry[];
  currentMessage: MessageEntry;
}): Promise<SelectionResult> {
  const { workspaceId, conversationId, history, currentMessage } = params;
  const totalMessages = history.length;

  // Under threshold: return full history unchanged.
  if (totalMessages <= COMPACTION_TRIGGER_THRESHOLD) {
    const messages = [...history, currentMessage];
    const estimatedTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0,
    );
    return {
      messages,
      mode: "full",
      stats: {
        totalMessages,
        keptMessages: messages.length,
        estimatedTokens,
        compactTokens: null,
      },
    };
  }

  // Over threshold: try compact+recent, fall back to budget-trim.
  let compact: { content: string; coveredUntil: number | null } | null = null;
  try {
    const doc = await prisma.document.findUnique({
      where: {
        sessionId_workspaceId: { sessionId: conversationId, workspaceId },
      },
      select: { content: true, metadata: true },
    });
    if (doc && typeof doc.content === "string" && doc.content.length > 0) {
      compact = {
        content: doc.content,
        coveredUntil: parseCoveredUntil(doc.metadata),
      };
    }
  } catch (error) {
    logger.warn("selectModelMessages: compact lookup failed, falling through", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (compact) {
    const coveredUntil = compact.coveredUntil;
    const compactText = `## ${COMPACT_PROMPT_MARKER}\n\n${compact.content}`;
    // Deliver the compact as a leading USER message, NOT a system message.
    // (See COMPACT_PROMPT_MARKER: convertMessages strips role:"system" entries,
    // so a system-role compact never reaches the model. A user-role context
    // block survives, mirroring how a /compact summary becomes the leading turn.)
    const compactMessage: MessageEntry = {
      id: `compact-${conversationId}`,
      role: "user",
      parts: [{ type: "text", text: compactText }],
    };

    // Hybrid verbatim tail: always keep the last RECENT_MESSAGE_WINDOW messages
    // for recency fidelity, AND extend further back to bridge any gap between
    // what the compact actually covers (coveredUntil) and that window — so a
    // lagging compaction can never drop messages that are in neither the compact
    // nor the verbatim tail. Biases to overlap (safe), never to a gap. When the
    // watermark is absent (docs compacted before #2), this is exactly the old
    // last-N behaviour.
    let tailStart = Math.max(0, history.length - RECENT_MESSAGE_WINDOW);
    if (coveredUntil != null) {
      const firstUncovered = history.findIndex(
        (m) =>
          m.createdAt != null &&
          new Date(m.createdAt).getTime() > coveredUntil,
      );
      if (firstUncovered >= 0) {
        tailStart = Math.min(tailStart, firstUncovered);
      }
    }

    // Budget cap: keep the tail newest-first under BUDGET_TRIM_TOKENS (minus the
    // compact + current). If the cap forces dropping messages the compact does
    // NOT cover, that is real context loss — surface it loudly (it must not
    // regress silently the way the original delivery bug did).
    const compactTokens = estimateMessageTokens(compactMessage);
    const currentTokens = estimateMessageTokens(currentMessage);
    const tailBudget = BUDGET_TRIM_TOKENS - compactTokens - currentTokens;
    const fullTail = history.slice(tailStart);
    const keptTail: MessageEntry[] = [];
    let tailUsed = 0;
    let droppedOldest = 0;
    for (let i = fullTail.length - 1; i >= 0; i--) {
      const cost = estimateMessageTokens(fullTail[i]);
      if (keptTail.length > 0 && tailUsed + cost > tailBudget) {
        droppedOldest = i + 1;
        break;
      }
      keptTail.unshift(fullTail[i]);
      tailUsed += cost;
    }

    if (droppedOldest > 0 && coveredUntil != null) {
      const lostUncovered = fullTail
        .slice(0, droppedOldest)
        .some(
          (m) =>
            m.createdAt != null &&
            new Date(m.createdAt).getTime() > coveredUntil,
        );
      if (lostUncovered) {
        logger.error(
          "selectModelMessages: budget cap dropped messages not covered by the compact (context gap)",
          {
            conversationId,
            droppedOldest,
            coveredUntil: new Date(coveredUntil).toISOString(),
          },
        );
      }
    }

    const messages = [compactMessage, ...keptTail, currentMessage];
    const estimatedTokens = compactTokens + currentTokens + tailUsed;
    return {
      messages,
      mode: "compact+recent",
      stats: {
        totalMessages,
        keptMessages: messages.length,
        estimatedTokens,
        compactTokens,
        coveredUntil:
          coveredUntil != null ? new Date(coveredUntil).toISOString() : null,
      },
    };
  }

  // Budget-trim: walk history backwards, keep what fits under BUDGET_TRIM_TOKENS.
  // Current message is always included; its cost is subtracted from the budget
  // up front. If the current message alone exceeds the budget, no history is
  // kept — the current message still goes through, and the model will either
  // accept it or fail with a context error that generateWithRetry handles.
  const currentTokens = estimateMessageTokens(currentMessage);
  const kept: MessageEntry[] = [];
  let used = currentTokens;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(history[i]);
    if (used + cost > BUDGET_TRIM_TOKENS) break;
    kept.unshift(history[i]);
    used += cost;
  }
  const messages = [...kept, currentMessage];
  return {
    messages,
    mode: "budget-trim",
    stats: {
      totalMessages,
      keptMessages: messages.length,
      estimatedTokens: used,
      compactTokens: null,
    },
  };
}

/**
 * Does this message carry the compact summary? Recognises both the pre-convert
 * UI shape (`parts: [{ text }]`) and the post-convert model shape
 * (`content: string` or `content: [{ text }]`), since the compact's `id` does
 * not survive convertMessages but COMPACT_PROMPT_MARKER does.
 */
function messageHasCompactMarker(message: any): boolean {
  if (!message) return false;
  const { content, parts } = message;
  if (typeof content === "string" && content.includes(COMPACT_PROMPT_MARKER)) {
    return true;
  }
  for (const list of [content, parts]) {
    if (Array.isArray(list)) {
      for (const p of list) {
        if (typeof p?.text === "string" && p.text.includes(COMPACT_PROMPT_MARKER)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Defense-in-depth: confirm the compact summary actually survived into the
 * messages handed to the model. convertMessages / provider adapters have been
 * observed silently dropping messages (notably mid-array role:"system"); when
 * that happens in compact+recent mode the agent loses everything older than the
 * recent window and re-asks for things it was already told. Only meaningful when
 * the selection mode is "compact+recent". Short-circuits on the first match
 * (the compact is the leading message), so it is cheap.
 */
export function compactSurvivedInModelMessages(modelMessages: any[]): boolean {
  for (const m of modelMessages ?? []) {
    if (messageHasCompactMarker(m)) return true;
  }
  return false;
}

/**
 * Drop the oldest user-assistant pair from a message array. Preserves leading
 * pinned messages — system prompts AND the injected compact summary (a leading
 * user message identified by COMPACT_PROMPT_MARKER) — and the last message
 * (current user turn). If no droppable pair exists, returns the input unchanged.
 */
function dropOldestRound(messages: any[]): any[] {
  if (messages.length <= 2) return messages;
  // Find the oldest droppable message — skip leading system prompts and the
  // pinned compact summary so context-length retries never evict them.
  let firstUserIdx = -1;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role !== "system" && !messageHasCompactMarker(messages[i])) {
      firstUserIdx = i;
      break;
    }
  }
  if (firstUserIdx < 0 || firstUserIdx >= messages.length - 1) {
    return messages;
  }
  const next = messages[firstUserIdx + 1];
  // Drop the user message plus the following assistant reply if present.
  const dropCount = next && next.role === "assistant" ? 2 : 1;
  // Never drop into the last (current) message.
  if (firstUserIdx + dropCount > messages.length - 1) {
    return messages;
  }
  return [
    ...messages.slice(0, firstUserIdx),
    ...messages.slice(firstUserIdx + dropCount),
  ];
}

function isContextLengthError(error: unknown): boolean {
  return describeAgentError(error).kind === "context-length";
}

export async function generateWithRetry(params: {
  agent: Agent;
  modelMessages: unknown[];
  generateOptions: Record<string, unknown>;
  conversationId: string;
}): Promise<any> {
  const { agent, generateOptions, conversationId } = params;
  let messages = params.modelMessages as any[];
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= CONTEXT_RETRY_MAX) {
    try {
      return await (agent as any).generate(messages, generateOptions);
    } catch (error) {
      lastError = error;
      if (!isContextLengthError(error) || attempt === CONTEXT_RETRY_MAX) {
        throw error;
      }
      const trimmed = dropOldestRound(messages);
      if (trimmed.length === messages.length) {
        // Nothing more to drop, give up.
        throw error;
      }
      logger.warn(
        "generateWithRetry: context-length error, retrying with trimmed history",
        {
          conversationId,
          attempt: attempt + 1,
          before: messages.length,
          after: trimmed.length,
        },
      );
      messages = trimmed;
      attempt += 1;
    }
  }

  throw lastError;
}

export function describeAgentError(error: unknown): AgentErrorDescription {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  const isContextLength =
    /context[_ ]?length/i.test(lower) ||
    /maximum context/i.test(lower) ||
    /too many tokens/i.test(lower) ||
    /prompt is too long/i.test(lower) ||
    /exceeds.*context/i.test(lower);
  if (isContextLength) {
    return {
      kind: "context-length",
      userMessage:
        "This conversation got too long for me to keep track of in one turn. Start a fresh conversation and I'll pick up from there — I keep memory of what we've discussed.",
    };
  }

  if (/timed? ?out|timeout|deadline/i.test(lower)) {
    return {
      kind: "timeout",
      userMessage:
        "I took too long on that one and timed out. Mind trying again, maybe with a narrower request?",
    };
  }

  if (/rate limit|429|too many requests/i.test(lower)) {
    return {
      kind: "rate-limit",
      userMessage:
        "Hit a rate limit on my side. Give me a minute and try again.",
    };
  }

  return {
    kind: "other",
    userMessage:
      "Something broke on my end before I could finish. Try again, and if it keeps failing let me know what you were doing.",
  };
}
