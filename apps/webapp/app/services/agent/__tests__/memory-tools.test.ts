import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMemorySearchTool } from "~/services/agent/tools/memory-tools";
import { type OrchestratorTools } from "~/services/agent/executors/base";

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
