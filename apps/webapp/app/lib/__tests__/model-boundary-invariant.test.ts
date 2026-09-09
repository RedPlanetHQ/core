import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Integration coverage for the boundary invariant's actual wiring, not just
 * the standalone checkPromptBoundary function (already covered in
 * promptBudget.test.ts). A cross-vendor review found the earlier version of
 * this diff had zero coverage proving the check fires from inside
 * makeModelCall / structuredCallWithTolerantParsing themselves — deleting the
 * wiring left every test green. These tests mock only the network-facing
 * edge (Mastra's Agent class) so the real makeModelCall /
 * makeStructuredModelCall / structuredCallWithTolerantParsing logic runs,
 * including checkPromptBoundary.
 *
 * model.server pulls in prisma/env through llm-provider.server and
 * tokenUsage.server, so both are stubbed — same approach as
 * ollama-model-detection.test.ts and rerank-budget.test.ts.
 */

const getDefaultChatProviderType = vi.fn<() => string>();
const resolveModelForWorkspace = vi.fn();
const getProviderConfig = vi.fn((provider: string) =>
  provider === "ollama" ? { baseUrl: "http://localhost:11434" } : {},
);

vi.mock("~/services/llm-provider.server", () => ({
  getDefaultChatProviderType: () => getDefaultChatProviderType(),
  resolveModelForWorkspace: (...args: unknown[]) => resolveModelForWorkspace(...args),
  getDefaultChatModelId: vi.fn(() => "qwen3:8b"),
  getDefaultEmbeddingInfo: vi.fn(),
  getProviderConfig: (...args: [string]) => getProviderConfig(...args),
  getEmbeddingDimensions: vi.fn(),
  resolveApiKey: vi.fn(),
  resolveApiKeyForWorkspace: vi.fn(),
}));

vi.mock("~/services/tokenUsage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/services/localEmbeddings.server", () => ({ embedLocal: vi.fn() }));

const generateMock = vi.fn();
const streamMock = vi.fn();

vi.mock("@mastra/core/agent", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    generate: (...args: unknown[]) => generateMock(...args),
    stream: (...args: unknown[]) => streamMock(...args),
  })),
}));

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));

import { logger } from "~/services/logger.service";
import { makeModelCall, makeStructuredModelCall } from "../model.server";

const OVER_BUDGET_TEXT = "a ".repeat(4000);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OLLAMA_PROMPT_BOUNDARY_MODE; // warn-only for all these tests
  getDefaultChatProviderType.mockReturnValue("openai");
  generateMock.mockResolvedValue({ text: "ok", usage: undefined });
  streamMock.mockResolvedValue({
    text: Promise.resolve("ok"),
    usage: Promise.resolve(undefined),
  });
});

function errorMessages(): string[] {
  return (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
    (call) => call[0] as string,
  );
}

describe("makeModelCall boundary wiring", () => {
  it("fires the boundary check for an over-budget prompt resolved to Ollama", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });

    await makeModelCall(false, [{ role: "user", content: OVER_BUDGET_TEXT }], () => {});

    expect(errorMessages().some((m) => m.includes("PromptBudget:boundary"))).toBe(true);
  });

  it("stays silent for the same oversized prompt when the model resolves to a hosted provider", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "openai/gpt-5" });

    await makeModelCall(false, [{ role: "user", content: OVER_BUDGET_TEXT }], () => {});

    expect(errorMessages()).toEqual([]);
  });

  it("does not throw in default (warn-only) mode even when over budget", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });

    await expect(
      makeModelCall(false, [{ role: "user", content: OVER_BUDGET_TEXT }], () => {}),
    ).resolves.toBeDefined();
  });

  it("throws once OLLAMA_PROMPT_BOUNDARY_MODE=throw is set", async () => {
    process.env.OLLAMA_PROMPT_BOUNDARY_MODE = "throw";
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });

    await expect(
      makeModelCall(false, [{ role: "user", content: OVER_BUDGET_TEXT }], () => {}),
    ).rejects.toThrow(/PromptBudget:boundary/);
  });
});

describe("makeStructuredModelCall boundary wiring (tolerant-parsing path)", () => {
  const schema = z.object({ ok: z.boolean() });

  it("fires the boundary check, counting the JSON preamble alongside the message content", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });
    generateMock.mockResolvedValue({ text: JSON.stringify({ ok: true }), usage: undefined });

    // Small message content alone would fit; only content + jsonPreamble + schema
    // together breach the budget, so this proves the preamble is really counted.
    await makeStructuredModelCall(schema, [{ role: "user", content: OVER_BUDGET_TEXT }]);

    expect(
      errorMessages().some(
        (m) => m.includes("PromptBudget:boundary") && m.includes("makeStructuredModelCall:chat/medium"),
      ),
    ).toBe(true);
  });

  it("stays silent when the resolved model is hosted", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "openai/gpt-5" });
    generateMock.mockResolvedValue({
      object: { ok: true },
      usage: undefined,
    });

    await makeStructuredModelCall(schema, [{ role: "user", content: OVER_BUDGET_TEXT }]);

    expect(errorMessages()).toEqual([]);
  });

  it("also fires the boundary check on the repair-retry path, under a distinct label", async () => {
    resolveModelForWorkspace.mockResolvedValue({ modelId: "ollama/qwen3:8b" });
    // First call: invalid JSON, forces the repair path. Second call (repair):
    // succeeds. The repair call's own input (this huge first-pass output) is
    // what should breach the repair check's budget.
    generateMock
      .mockResolvedValueOnce({ text: OVER_BUDGET_TEXT, usage: undefined })
      .mockResolvedValueOnce({ text: JSON.stringify({ ok: true }), usage: undefined });

    await makeStructuredModelCall(schema, [{ role: "user", content: "short" }]);

    expect(errorMessages().some((m) => m.includes(":repair"))).toBe(true);
  });
});
