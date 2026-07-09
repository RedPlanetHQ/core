import { beforeEach, describe, expect, it, vi } from "vitest";

// --- registration test mocks (hoisted) -------------------------------------
vi.mock("~/db.server", () => ({
  prisma: {
    subscription: { findFirst: vi.fn().mockResolvedValue({ planType: "PRO" }) },
    gateway: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("~/services/channel.server", () => ({
  getWorkspaceChannelContext: vi
    .fn()
    .mockResolvedValue({ availableTypes: ["email"], channels: [] }),
}));
// core.ts -> ./decision -> ../mastra constructs a real PostgresStore at
// module load (`export const mastra = singleton("mastra", getMastra)`),
// which throws under vitest since DATABASE_URL etc. aren't set. Not
// exercised by createCoreTools itself, so stub it out.
vi.mock("~/services/agent/mastra", () => ({
  mastra: {},
  getMastra: vi.fn(),
}));

import { getMemorySearchTool } from "~/services/agent/tools/memory-tools";
import { type OrchestratorTools } from "~/services/agent/executors/base";
import { createCoreTools } from "~/services/agent/agents/core";

// The tool() factory returns AI SDK tools whose execute signature is
// (input, context) — we don't pass context in unit tests.
type ExecutableTool = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const searchMemory = vi.fn();

// Only searchMemory is exercised by this tool; the rest of the abstract
// surface is irrelevant here.
const executor = { searchMemory } as unknown as OrchestratorTools;

describe("memory-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to executor.searchMemory with query and identity params", async () => {
    searchMemory.mockResolvedValueOnce("### Episode 1\nuser prefers italian");

    const tool = getMemorySearchTool({
      userId: "user_1",
      workspaceId: "ws_1",
      source: "core",
      executor,
    }) as unknown as ExecutableTool;

    const result = await tool.execute({
      query: "user's dinner preferences and past restaurant choices",
    });

    expect(searchMemory).toHaveBeenCalledWith(
      "user's dinner preferences and past restaurant choices",
      "user_1",
      "ws_1",
      "core",
    );
    expect(result).toBe("### Episode 1\nuser prefers italian");
  });

  it("passes through the executor's empty-result string unchanged", async () => {
    searchMemory.mockResolvedValueOnce("nothing found");

    const tool = getMemorySearchTool({
      userId: "user_1",
      workspaceId: "ws_1",
      source: "whatsapp",
      executor,
    }) as unknown as ExecutableTool;

    const result = await tool.execute({ query: "anything about project X" });

    expect(result).toBe("nothing found");
  });
});

describe("createCoreTools memory_search registration", () => {
  const base = {
    userId: "user_1",
    workspaceId: "ws_1",
    timezone: "UTC",
    source: "core",
  };

  it("registers memory_search in interactive configuration", async () => {
    const tools = await createCoreTools({ ...base });
    expect(tools["memory_search"]).toBeDefined();
  });

  it("registers memory_search in background/readOnly configuration", async () => {
    const tools = await createCoreTools({
      ...base,
      readOnly: true,
      isBackgroundExecution: true,
    });
    expect(tools["memory_search"]).toBeDefined();
  });

  it("threads a provided executor into the registered tool", async () => {
    const customSearch = vi
      .fn()
      .mockResolvedValueOnce("### Episode 1\nfrom custom executor");
    const customExecutor = {
      searchMemory: customSearch,
    } as unknown as OrchestratorTools;

    const tools = await createCoreTools({
      ...base,
      executorTools: customExecutor,
    });

    const result = await (
      tools["memory_search"] as unknown as ExecutableTool
    ).execute({ query: "anything" });

    expect(customSearch).toHaveBeenCalledWith(
      "anything",
      "user_1",
      "ws_1",
      "core",
    );
    expect(result).toBe("### Episode 1\nfrom custom executor");
  });
});
