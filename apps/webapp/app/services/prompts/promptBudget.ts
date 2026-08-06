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

function fitMarkerToBudget(budget: number): string {
  if (budget <= 0) {
    return "";
  }

  return decode(encode(TRUNCATION_MARKER).slice(0, budget));
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
