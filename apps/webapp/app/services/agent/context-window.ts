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

// ─── Stubs (filled in by later tasks) ───────────────────────────────

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
  let compact: { content: string } | null = null;
  try {
    const doc = await prisma.document.findUnique({
      where: {
        sessionId_workspaceId: { sessionId: conversationId, workspaceId },
      },
      select: { content: true },
    });
    if (doc && typeof doc.content === "string" && doc.content.length > 0) {
      compact = { content: doc.content };
    }
  } catch (error) {
    logger.warn("selectModelMessages: compact lookup failed, falling through", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (compact) {
    const compactText = `## Earlier in this conversation\n\n${compact.content}`;
    const compactMessage: MessageEntry = {
      id: `compact-${conversationId}`,
      role: "system",
      parts: [{ type: "text", text: compactText }],
    };
    const recent = history.slice(-RECENT_MESSAGE_WINDOW);
    const messages = [compactMessage, ...recent, currentMessage];
    const compactTokens = estimateMessageTokens(compactMessage);
    const estimatedTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0,
    );
    return {
      messages,
      mode: "compact+recent",
      stats: {
        totalMessages,
        keptMessages: messages.length,
        estimatedTokens,
        compactTokens,
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
 * Drop the oldest user-assistant pair from a message array. Preserves the
 * first message (system/compact) and the last message (current user turn).
 * If no pair exists to drop, returns the input unchanged.
 */
function dropOldestRound(messages: any[]): any[] {
  if (messages.length <= 2) return messages;
  // Find the oldest non-system message index (skip leading system prompts).
  let firstUserIdx = -1;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role !== "system") {
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
