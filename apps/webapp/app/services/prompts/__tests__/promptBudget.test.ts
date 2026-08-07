import { describe, it, expect } from "vitest";
import {
  OLLAMA_NUM_CTX,
  OLLAMA_NUM_PREDICT_DEFAULT,
  assertPromptWithinBudget,
  capToTokenBudget,
  capToTokenBudgetFromEnd,
} from "../promptBudget";
import { countTokens } from "~/services/search/tokenBudget";

const LONG = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(100);

/**
 * Sparse-ASCII head, dense CJK/emoji tail. Token density varies by more than an
 * order of magnitude across this string, which is exactly what defeats
 * character-ratio slicing: a ratio computed from the whole string wildly
 * under-counts the tokens actually present in the tail it keeps.
 */
const MIXED_DENSITY =
  "a ".repeat(4000) + "私はこれを覚えています🎉🔥".repeat(400);

describe("OLLAMA_NUM_CTX", () => {
  it("is pinned to 4096 — raising it evicted qwen3:8b from an 8GB RTX 4060", () => {
    // Guard constant. If someone raises this, that hardware finding must be re-run.
    expect(OLLAMA_NUM_CTX).toBe(4096);
  });

  it("reserves a sane default completion allowance that fits the window", () => {
    expect(OLLAMA_NUM_PREDICT_DEFAULT).toBeGreaterThan(0);
    expect(OLLAMA_NUM_PREDICT_DEFAULT).toBeLessThan(OLLAMA_NUM_CTX);
  });
});

describe("capToTokenBudget", () => {
  it("returns the input unchanged when already within budget", () => {
    const text = "Klaus prefers dark mode";
    expect(capToTokenBudget(text, 1000)).toBe(text);
  });

  it("returns a string that genuinely re-counts to within budget when over", () => {
    for (const budget of [10, 50, 140, 500]) {
      const result = capToTokenBudget(LONG, budget);
      expect(countTokens(result)).toBeLessThanOrEqual(budget);
    }
  });

  it("marks the text as truncated so the model can tell it was cut", () => {
    expect(capToTokenBudget(LONG, 140)).toContain("[truncated]");
  });

  it("preserves the beginning of the text rather than an arbitrary slice", () => {
    const text = "FIRSTTOKEN " + LONG;
    expect(capToTokenBudget(text, 50).startsWith("FIRSTTOKEN")).toBe(true);
  });

  it("handles empty input", () => {
    expect(capToTokenBudget("", 100)).toBe("");
  });

  it("handles a zero budget without emitting an over-budget marker", () => {
    expect(capToTokenBudget(LONG, 0)).toBe("");
  });
});

describe("assertPromptWithinBudget", () => {
  it("does not throw when the prompt is within budget", () => {
    expect(() =>
      assertPromptWithinBudget({ label: "test", text: "short", budget: 100 }),
    ).not.toThrow();
  });

  it("throws naming the label, the actual count, and the budget when over", () => {
    const actual = countTokens(LONG);
    expect(() =>
      assertPromptWithinBudget({ label: "search-rerank", text: LONG, budget: 10 }),
    ).toThrow(new RegExp(`search-rerank.*${actual}.*10`));
  });

  it("is the fail-loud guard against Ollama silently truncating an over-budget prompt", () => {
    // The original bug class: Ollama drops overflow silently. Throwing is the fix.
    expect(() =>
      assertPromptWithinBudget({ label: "ingest", text: LONG, budget: OLLAMA_NUM_CTX - 1 }),
    ).not.toThrow();
    expect(() =>
      assertPromptWithinBudget({ label: "ingest", text: LONG, budget: 5 }),
    ).toThrow();
  });
});

describe("capToTokenBudgetFromEnd", () => {
  it("returns short text untouched", () => {
    expect(capToTokenBudgetFromEnd("short", 100)).toBe("short");
  });

  it("keeps the tail, not the head", () => {
    // Session context is oldest-first, so truncation must drop the beginning.
    const text = `OLDEST ${"filler ".repeat(300)}NEWEST`;
    const capped = capToTokenBudgetFromEnd(text, 50);
    expect(capped).toContain("NEWEST");
    expect(capped).not.toContain("OLDEST");
    expect(countTokens(capped)).toBeLessThanOrEqual(50);
  });

  it("respects the budget on mixed-density text that defeats ratio slicing", () => {
    // Regression: the char-ratio version measured 4075 tokens against a 3500
    // budget on this shape and threw. Token-exact convergence must not.
    const budget = 3500;
    expect(countTokens(capToTokenBudgetFromEnd(MIXED_DENSITY, budget)))
      .toBeLessThanOrEqual(budget);
  });

  it("beats the character-ratio estimate it replaced", () => {
    const budget = 3500;
    const contextTokens = countTokens(MIXED_DENSITY);
    const ratio = budget / contextTokens;
    const startChar = Math.floor((1 - ratio) * MIXED_DENSITY.length);
    const estimated = "...[earlier context omitted]\n" + MIXED_DENSITY.substring(startChar);

    // Proves the old approach genuinely overshot rather than being merely untidy.
    expect(countTokens(estimated)).toBeGreaterThan(budget);
    expect(countTokens(capToTokenBudgetFromEnd(MIXED_DENSITY, budget)))
      .toBeLessThanOrEqual(budget);
  });

  it("degrades to empty rather than overflowing on a zero budget", () => {
    expect(capToTokenBudgetFromEnd(LONG, 0)).toBe("");
  });
});
