import { describe, it, expect, vi } from "vitest";

// rerank.ts pulls in model.server -> tokenUsage.server -> prisma/env, which
// requires a live DATABASE_URL. These tests only exercise pure prompt
// assembly, so stub the model layer and keep the file runnable without a
// database.
vi.mock("~/lib/model.server", () => ({ makeModelCall: vi.fn() }));

import { countTokens } from "../tokenBudget";
import {
  buildRerankValidationPrompt,
  RERANK_EPISODE_CONTENT_TOKEN_BUDGET,
  RERANK_OUTPUT_TOKEN_RESERVE,
  RERANK_PROMPT_TOKEN_BUDGET,
  RERANK_QUERY_TOKEN_BUDGET,
  RERANK_STATEMENT_FACT_TOKEN_BUDGET,
} from "../rerank";
import { OLLAMA_NUM_CTX } from "~/services/prompts/promptBudget";

/**
 * Batch size in validateEpisodesWithLLMInBatches. If that changes, this test
 * must fail loudly rather than the budget silently becoming wrong.
 */
const BATCH_SIZE = 10;

const FILLER = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(200);

/** An episode whose every capped field is far larger than its budget. */
function worstCaseEpisode(index: number): any {
  return {
    episode: {
      uuid: `uuid-${index}`,
      content: FILLER,
      originalContent: FILLER,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    firstLevelScore: 0.5,
    sourceBreakdown: {
      fromEpisodeGraph: 1000,
      fromBFS: 1000,
      fromVector: 1000,
      fromBM25: 1000,
    },
    // Far more statements than the 5 the prompt renders.
    statements: Array.from({ length: 50 }, () => ({ statement: { fact: FILLER } })),
  };
}

describe("rerank prompt token budget", () => {
  it("the declared budget plus reserved output fits inside Ollama's pinned context window", () => {
    expect(RERANK_PROMPT_TOKEN_BUDGET + RERANK_OUTPUT_TOKEN_RESERVE).toBeLessThanOrEqual(
      OLLAMA_NUM_CTX,
    );
  });

  it("a full batch of maximally-large episodes stays within the declared budget", () => {
    const episodes = Array.from({ length: BATCH_SIZE }, (_, i) => worstCaseEpisode(i));
    const prompt = buildRerankValidationPrompt(FILLER, episodes);

    // The assertion in validateEpisodesWithLLM throws above this number, so if
    // this ever regresses, reranking breaks in production rather than degrading.
    expect(countTokens(prompt)).toBeLessThanOrEqual(RERANK_PROMPT_TOKEN_BUDGET);
  });

  it("caps an oversized episode content instead of interpolating it whole", () => {
    const prompt = buildRerankValidationPrompt("q", [worstCaseEpisode(0)]);
    expect(prompt).not.toContain(FILLER);
    expect(prompt).toContain("[truncated]");
  });

  it("caps an oversized query", () => {
    const prompt = buildRerankValidationPrompt(FILLER, []);
    expect(prompt).not.toContain(FILLER);
    expect(countTokens(prompt)).toBeLessThanOrEqual(RERANK_PROMPT_TOKEN_BUDGET);
  });

  it("leaves a small, already-within-budget prompt untouched", () => {
    const small: any = {
      episode: {
        uuid: "small",
        content: "Klaus prefers dark mode",
        originalContent: "Klaus prefers dark mode",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      firstLevelScore: 0.9,
      sourceBreakdown: { fromEpisodeGraph: 1, fromBFS: 0, fromVector: 0, fromBM25: 0 },
      statements: [{ statement: { fact: "Klaus prefers dark mode" } }],
    };

    const prompt = buildRerankValidationPrompt("what theme?", [small]);
    // Nothing was cut, so hosted providers see byte-identical content to before.
    expect(prompt).toContain("Klaus prefers dark mode");
    expect(prompt).not.toContain("[truncated]");
    expect(prompt).toContain('Query: "what theme?"');
  });

  it("budgets are internally consistent with the documented arithmetic", () => {
    const staticOnly = countTokens(buildRerankValidationPrompt("", []));
    const perEpisodeOverhead =
      countTokens(buildRerankValidationPrompt("", [worstCaseEpisode(0)])) -
      staticOnly -
      RERANK_EPISODE_CONTENT_TOKEN_BUDGET -
      5 * RERANK_STATEMENT_FACT_TOKEN_BUDGET;

    const predictedWorstCase =
      staticOnly +
      RERANK_QUERY_TOKEN_BUDGET +
      BATCH_SIZE *
        (RERANK_EPISODE_CONTENT_TOKEN_BUDGET +
          5 * RERANK_STATEMENT_FACT_TOKEN_BUDGET +
          perEpisodeOverhead);

    expect(predictedWorstCase).toBeLessThanOrEqual(RERANK_PROMPT_TOKEN_BUDGET);
  });
});
