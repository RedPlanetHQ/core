import { describe, expect, it, vi } from "vitest";

vi.mock("~/services/llm-provider.server", () => ({
  getDefaultChatProviderType: () => "openai",
  getProviderConfig: () => ({ apiMode: "responses" }),
}));
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/services/localEmbeddings.server", () => ({ embedLocal: vi.fn() }));
vi.mock("~/services/tokenUsage.server", () => ({ recordTokenUsage: vi.fn() }));

import { buildOpenAIProviderOptions } from "../model.server";

const effortFor = (model: string, requested?: "low" | "medium" | "high") =>
  buildOpenAIProviderOptions(model, "test-key", requested)?.openai
    .reasoningEffort;

describe("buildOpenAIProviderOptions reasoning effort", () => {
  it.each(["openai/gpt-5-2025-08-07", "gpt-5"])(
    "uses minimal for the original GPT-5 family (%s)",
    (model) => {
      expect(effortFor(model)).toBe("minimal");
    },
  );

  it.each([
    "openai/gpt-5.1-2025-11-13",
    "openai/gpt-5.2-2025-12-11",
    "openai/gpt-5.4",
  ])("uses none for GPT-5.1 and later (%s)", (model) => {
    expect(effortFor(model)).toBe("none");
  });

  it("keeps low for mini models", () => {
    expect(effortFor("openai/gpt-5-mini-2025-08-07")).toBe("low");
  });

  it("prefers an explicitly requested effort", () => {
    expect(effortFor("openai/gpt-5.4", "high")).toBe("high");
  });

  it("skips non-OpenAI models", () => {
    expect(
      buildOpenAIProviderOptions("anthropic/claude-haiku-4-5", "test-key"),
    ).toBeUndefined();
  });
});
