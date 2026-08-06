import { describe, it, expect } from "vitest";
import {
  OLLAMA_NUM_CTX,
  OLLAMA_NUM_PREDICT_DEFAULT,
  assertPromptWithinBudget,
  capToTokenBudget,
} from "../promptBudget";
import { countTokens } from "~/services/search/tokenBudget";

const LONG = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(100);

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
