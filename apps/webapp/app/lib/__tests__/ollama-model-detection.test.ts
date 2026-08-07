import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for the two functions every cap, assertion, provider option and
 * tolerant-parsing decision on this branch keys off.
 *
 * This predicate was confidently wrong once already: it carried an extra
 * `|| getDefaultChatProviderType() === "ollama"` clause, justified by a comment
 * claiming getModel() routes everything to Ollama under CHAT_PROVIDER=ollama.
 * makeModelCall actually goes through createAgent, which only reaches getModel
 * once the provider is already ollama/azure/proxy — so a "provider/model"
 * override to a hosted model was reported as Ollama and had its prompt capped
 * for a model running on OpenAI.
 *
 * The regression these guard is concrete and silent in both directions:
 * re-adding that env clause caps prompts for hosted models, while breaking
 * inferProvider's env check would hand every Ollama call the uncapped hosted
 * profile — the original silent-truncation bug, restored, with no error.
 *
 * model.server pulls in prisma/env through llm-provider.server and
 * tokenUsage.server, so both are stubbed to keep this runnable without a
 * database — the same approach rerank-budget.test.ts uses.
 */

const getDefaultChatProviderType = vi.fn<() => string>();
const resolveModelForWorkspace = vi.fn();

vi.mock("~/services/llm-provider.server", () => ({
  getDefaultChatProviderType: () => getDefaultChatProviderType(),
  resolveModelForWorkspace: (...args: unknown[]) => resolveModelForWorkspace(...args),
  getDefaultChatModelId: vi.fn(() => "qwen3:8b"),
  getDefaultEmbeddingInfo: vi.fn(),
  getProviderConfig: vi.fn(() => ({})),
  getEmbeddingDimensions: vi.fn(),
  resolveApiKey: vi.fn(),
  resolveApiKeyForWorkspace: vi.fn(),
}));

vi.mock("~/services/tokenUsage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/services/localEmbeddings.server", () => ({ embedLocal: vi.fn() }));

import { isOllamaModel, resolveProfileForCall } from "../model.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isOllamaModel", () => {
  it("detects a bare model id when CHAT_PROVIDER is ollama", () => {
    // Bare ids carry no provider, so detection legitimately depends on the env
    // default — via inferProvider, not via a separate clause in this predicate.
    getDefaultChatProviderType.mockReturnValue("ollama");
    expect(isOllamaModel("qwen3:8b")).toBe(true);
  });

  it("does not claim a bare model id is Ollama under a hosted default", () => {
    getDefaultChatProviderType.mockReturnValue("openai");
    expect(isOllamaModel("gpt-5-2025-08-07")).toBe(false);
  });

  it("lets an explicit hosted override beat CHAT_PROVIDER=ollama", () => {
    // The false positive that was removed. createAgent resolves this to the
    // Mastra router and the call genuinely runs on OpenAI, so reporting Ollama
    // here caps the prompt and emits num_ctx for a model that needs neither.
    getDefaultChatProviderType.mockReturnValue("ollama");
    expect(isOllamaModel("openai/gpt-5")).toBe(false);
  });

  it("lets an explicit Ollama override beat CHAT_PROVIDER=openai", () => {
    // The direction that actually matters: miss this and the prompt is built
    // with no caps and no assertion for a model behind a 4096-token window.
    getDefaultChatProviderType.mockReturnValue("openai");
    expect(isOllamaModel("ollama/qwen3:8b")).toBe(true);
  });
});

describe("resolveProfileForCall", () => {
  it("returns the ollama profile when the resolved model is Ollama", async () => {
    getDefaultChatProviderType.mockReturnValue("openai");
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });

    // A workspace override reaching Ollama while CHAT_PROVIDER says otherwise
    // is exactly the case that previously selected the uncapped hosted profile.
    await expect(resolveProfileForCall("ws-1", "memory", "medium")).resolves.toBe(
      "ollama",
    );
  });

  it("returns the hosted profile when the resolved model is hosted", async () => {
    getDefaultChatProviderType.mockReturnValue("ollama");
    resolveModelForWorkspace.mockResolvedValue({ modelId: "openai/gpt-5" });

    await expect(resolveProfileForCall("ws-1", "memory", "medium")).resolves.toBe(
      "hosted",
    );
  });

  it("resolves against the model for this specific call, not the env default", async () => {
    getDefaultChatProviderType.mockReturnValue("openai");
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });

    await resolveProfileForCall("ws-1", "memory", "low");

    // Passing useCase/complexity through is load-bearing: a pending routing
    // change excludes conversation-normalization from Ollama while keeping
    // other use-cases on it, and that only works if the profile is resolved
    // per call rather than from a global setting.
    expect(resolveModelForWorkspace).toHaveBeenCalledWith("ws-1", "memory", "low");
  });

  it("defaults useCase and complexity to makeModelCall's own defaults", async () => {
    getDefaultChatProviderType.mockReturnValue("openai");
    resolveModelForWorkspace.mockResolvedValue({ modelId: "openai/gpt-5" });

    await resolveProfileForCall("ws-1");

    expect(resolveModelForWorkspace).toHaveBeenCalledWith("ws-1", "chat", "medium");
  });
});
