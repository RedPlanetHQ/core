import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { logger } from "../logger.service";

/**
 * Default token budget for recall output (10K tokens)
 * Prevents context bloat for agents consuming the results
 */
export const DEFAULT_TOKEN_BUDGET = 10000;

/**
 * Episode with content for token counting
 */
interface EpisodeWithContent {
  uuid: string;
  content: string;
}

/**
 * Count tokens in a string using gpt-tokenizer (o200k encoding)
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Apply token budget to episodes by dropping least relevant episodes from the tail
 *
 * Algorithm:
 * 1. Episodes are assumed to be sorted by relevance (most relevant first)
 * 2. Calculate total tokens across all episodes
 * 3. If total > budget, drop episodes from the end (least relevant)
 * 4. Continue until total ≤ budget
 * 5. Return remaining complete episodes (no mid-episode cuts)
 *
 * @param episodes - Episodes sorted by relevance (most relevant first)
 * @param budget - Token budget (default: 10000)
 * @returns Episodes that fit within the budget
 */
export function applyTokenBudget<T extends EpisodeWithContent>(
  episodes: T[],
  budget: number = DEFAULT_TOKEN_BUDGET
): { episodes: T[]; droppedCount: number; totalTokens: number } {
  if (episodes.length === 0) {
    return { episodes: [], droppedCount: 0, totalTokens: 0 };
  }

  // Calculate token counts for each episode
  const episodeTokens = episodes.map((ep) => ({
    episode: ep,
    tokens: countTokens(ep.content),
  }));

  let totalTokens = episodeTokens.reduce((sum, et) => sum + et.tokens, 0);

  // If already under budget, return all
  if (totalTokens <= budget) {
    logger.debug(
      `[TokenBudget] All ${episodes.length} episodes fit within budget ` +
        `(${totalTokens}/${budget} tokens)`
    );
    return { episodes, droppedCount: 0, totalTokens };
  }

  // Drop episodes from the tail (least relevant) until under budget
  const result: typeof episodeTokens = [...episodeTokens];
  let droppedCount = 0;

  while (totalTokens > budget && result.length > 0) {
    const dropped = result.pop()!;
    totalTokens -= dropped.tokens;
    droppedCount++;
  }

  const finalEpisodes = result.map((et) => et.episode);

  logger.info(
    `[TokenBudget] Dropped ${droppedCount} episodes to fit budget. ` +
      `${finalEpisodes.length} episodes remaining (${totalTokens}/${budget} tokens)`
  );

  return {
    episodes: finalEpisodes,
    droppedCount,
    totalTokens,
  };
}

/**
 * Apply token budget specifically to RecallEpisode format
 * Used by search-v2
 */
export function applyTokenBudgetToRecallEpisodes<
  T extends { uuid: string; content: string }
>(
  episodes: T[],
  budget: number = DEFAULT_TOKEN_BUDGET
): { episodes: T[]; droppedCount: number; totalTokens: number } {
  return applyTokenBudget(episodes, budget);
}
