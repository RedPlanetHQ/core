import { decode, encode } from "gpt-tokenizer/encoding/o200k_base";
import { countTokens } from "~/services/search/tokenBudget";

/**
 * Pinned to 4096 on purpose.
 *
 * Core is deployed against an RTX 4060 with 8GB VRAM, shared with
 * `nomic-embed-text`. Raising Ollama `num_ctx` from 4096 to 8192 was
 * directly tested and evicted `qwen3:8b` from VRAM entirely, forcing CPU
 * inference. Do not "helpfully" increase this without re-running that exact
 * hardware validation.
 */
export const OLLAMA_NUM_CTX = 4096;

/**
 * Default completion budget reserved for local Ollama calls unless a caller
 * requests a tighter or looser limit explicitly.
 */
export const OLLAMA_NUM_PREDICT_DEFAULT = 512;

const TRUNCATION_MARKER = "...[truncated]";
const HEAD_TRUNCATION_MARKER = "...[earlier context omitted]\n";

function fitMarkerToBudget(budget: number, marker = TRUNCATION_MARKER): string {
  if (budget <= 0) {
    return "";
  }

  return decode(encode(marker).slice(0, budget));
}

export function capToTokenBudget(text: string, budget: number): string {
  if (text.length === 0) {
    return "";
  }

  if (budget <= 0) {
    return "";
  }

  if (countTokens(text) <= budget) {
    return text;
  }

  const marker = fitMarkerToBudget(budget);
  if (marker.length === 0) {
    return "";
  }

  const encodedText = encode(text);
  let best = marker;
  let low = 0;
  let high = Math.min(encodedText.length, budget);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${decode(encodedText.slice(0, mid))}${marker}`;
    const candidateTokens = countTokens(candidate);

    if (candidateTokens <= budget) {
      best = candidate;
      low = mid + 1;
      continue;
    }

    high = mid - 1;
  }

  return best;
}

/**
 * Same contract as capToTokenBudget, but keeps the END of the text and drops
 * the beginning.
 *
 * Session context is ordered oldest-first, so the most recent entries — the
 * ones most relevant to the current episode — live at the tail. Callers that
 * need that ordering used to slice by character ratio, which only *estimates*
 * the resulting token count: token density varies enormously across scripts, so
 * a document with a sparse-ASCII head and a dense CJK/emoji tail overshoots
 * badly. That was survivable while overflow was silent, and became a crash once
 * exceeding the budget started throwing. This converges on the real count the
 * same way capToTokenBudget does.
 */
export function capToTokenBudgetFromEnd(text: string, budget: number): string {
  if (text.length === 0 || budget <= 0) {
    return "";
  }

  if (countTokens(text) <= budget) {
    return text;
  }

  const marker = fitMarkerToBudget(budget, HEAD_TRUNCATION_MARKER);
  if (marker.length === 0) {
    return "";
  }

  const encodedText = encode(text);
  let best = marker;
  let low = 0;
  let high = Math.min(encodedText.length, budget);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${marker}${decode(encodedText.slice(encodedText.length - mid))}`;
    const candidateTokens = countTokens(candidate);

    if (candidateTokens <= budget) {
      best = candidate;
      low = mid + 1;
      continue;
    }

    high = mid - 1;
  }

  return best;
}

export function assertPromptWithinBudget(params: {
  label: string;
  text: string;
  budget: number;
}): void {
  const actualTokens = countTokens(params.text);
  if (actualTokens <= params.budget) {
    return;
  }

  throw new Error(
    `[PromptBudget] ${params.label} is ${actualTokens} tokens, exceeds budget ${params.budget}`,
  );
}
