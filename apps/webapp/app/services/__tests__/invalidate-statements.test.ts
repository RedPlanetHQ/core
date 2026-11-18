import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidateStatement = vi.fn();

vi.mock("@core/providers", () => ({
  ProviderFactory: {
    getGraphProvider: () => ({ invalidateStatement }),
    getVectorProvider: () => ({}),
  },
  VECTOR_NAMESPACES: {},
}));

import { invalidateStatements } from "~/services/graphModels/statement";

describe("invalidateStatements", () => {
  beforeEach(() => {
    invalidateStatement.mockReset();
  });

  it("waits for every statement write before resolving", async () => {
    const finished: string[] = [];
    invalidateStatement.mockImplementation(async (uuid: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(uuid);
    });

    await invalidateStatements({
      statementIds: ["s1", "s2", "s3"],
      invalidatedBy: "episode-1",
      userId: "user-1",
      workspaceId: "ws-1",
    });

    expect(finished.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("passes the same timestamp and episode to every statement", async () => {
    invalidateStatement.mockResolvedValue(undefined);

    await invalidateStatements({
      statementIds: ["s1", "s2"],
      invalidatedBy: "episode-1",
      userId: "user-1",
      workspaceId: "ws-1",
    });

    expect(invalidateStatement).toHaveBeenCalledTimes(2);
    const [first, second] = invalidateStatement.mock.calls;
    expect(first[1]).toBe("episode-1");
    expect(first[2]).toEqual(second[2]);
    expect(first[3]).toBe("user-1");
    expect(first[4]).toBe("ws-1");
  });

  it("surfaces a failed write to the caller", async () => {
    invalidateStatement
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("neo4j down"));

    await expect(
      invalidateStatements({
        statementIds: ["s1", "s2"],
        invalidatedBy: "episode-1",
        userId: "user-1",
      }),
    ).rejects.toThrow("neo4j down");
  });
});
