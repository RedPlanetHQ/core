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
    const sharedInvalidAt = invalidateStatement.mock.calls[0][2];
    expect(sharedInvalidAt).toBeInstanceOf(Date);
    expect(invalidateStatement).toHaveBeenNthCalledWith(
      1,
      "s1",
      "episode-1",
      sharedInvalidAt,
      "user-1",
      "ws-1",
    );
    expect(invalidateStatement).toHaveBeenNthCalledWith(
      2,
      "s2",
      "episode-1",
      sharedInvalidAt,
      "user-1",
      "ws-1",
    );
  });

  it("waits for pending writes before reporting a failure", async () => {
    let slowWriteDone = false;
    invalidateStatement
      .mockRejectedValueOnce(new Error("neo4j down"))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        slowWriteDone = true;
      });

    await expect(
      invalidateStatements({
        statementIds: ["s1", "s2"],
        invalidatedBy: "episode-1",
        userId: "user-1",
      }),
    ).rejects.toThrow("neo4j down");
    expect(slowWriteDone).toBe(true);
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
