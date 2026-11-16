import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

const state = vi.hoisted(() => ({ model: undefined as any }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: () => state.model }),
}));
vi.mock("~/services/llm-provider.server", () => ({
  getDefaultChatProviderType: () => "openai",
  getProviderConfig: () => ({
    apiMode: "chat_completions",
    baseUrl: "https://proxy.example",
  }),
  resolveModelForWorkspace: async () => ({
    modelId: "openai/test-model",
    apiKey: "test-key",
    baseUrl: "https://proxy.example",
    isBYOK: true,
  }),
}));
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/services/localEmbeddings.server", () => ({ embedLocal: vi.fn() }));
vi.mock("~/services/tokenUsage.server", () => ({ recordTokenUsage: vi.fn() }));

import { makeModelCall } from "../model.server";

beforeEach(() => {
  const usage = {
    inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  state.model = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text", text: "result" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    },
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "result" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      }),
  });
});

describe("makeModelCall settings reaching the provider through the real Mastra Agent", () => {
  it.each([false, true])(
    "forwards zero temperature and output limit (stream=%s)",
    async (stream) => {
      const onFinish = vi.fn();
      expect(
        await makeModelCall(
          stream,
          [{ role: "user", content: "hello" }],
          onFinish,
          { temperature: 0, maxTokens: 500 },
        ),
      ).toBe("result");
      // Mastra itself invokes doStream for both generate and stream.
      const calls = [
        ...state.model.doGenerateCalls,
        ...state.model.doStreamCalls,
      ];
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ temperature: 0, maxOutputTokens: 500 });
      expect(onFinish).toHaveBeenCalledWith(
        "result",
        "openai/test-model",
        expect.any(Object),
      );
    },
  );
  it.each([false, true])(
    "keeps default settings when options are omitted (stream=%s)",
    async (stream) => {
      expect(
        await makeModelCall(
          stream,
          [{ role: "user", content: "hello" }],
          vi.fn(),
        ),
      ).toBe("result");
      const calls = [
        ...state.model.doGenerateCalls,
        ...state.model.doStreamCalls,
      ];
      expect(calls).toHaveLength(1);
      expect(calls[0].maxOutputTokens).toBeUndefined();
    },
  );
});
