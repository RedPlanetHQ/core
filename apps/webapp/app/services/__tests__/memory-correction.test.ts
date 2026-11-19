import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  memoryCorrection: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
}));
const statementMock = vi.hoisted(() => ({
  findSimilarStatements: vi.fn(),
  getStatements: vi.fn(),
  invalidateStatementsBatch: vi.fn(),
  restoreInvalidatedStatements: vi.fn(),
}));
const aspectMock = vi.hoisted(() => ({
  findSimilarVoiceAspects: vi.fn(),
  getVoiceAspectsByIds: vi.fn(),
  invalidateVoiceAspects: vi.fn(),
  restoreVoiceAspects: vi.fn(),
}));
const addToQueue = vi.hoisted(() => vi.fn());

vi.mock("@core/database", () => ({
  MemoryCorrectionAction: { RETIRE: "RETIRE", CORRECT: "CORRECT" },
  MemoryCorrectionStatus: {
    PROPOSED: "PROPOSED",
    APPLIED: "APPLIED",
    REJECTED: "REJECTED",
    RESTORED: "RESTORED",
  },
}));
vi.mock("~/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/ingest.server", () => ({ addToQueue }));
vi.mock("~/lib/model.server", () => ({
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
}));
vi.mock("~/services/graphModels/statement", () => statementMock);
vi.mock("~/services/aspectStore.server", () => aspectMock);
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyCorrection,
  correctionTag,
  findFacts,
  MemoryCorrectionError,
  proposeCorrection,
  rejectCorrection,
  restoreCorrection,
} from "~/services/memoryCorrection.server";

const scope = { userId: "user-1", workspaceId: "ws-1" };
const validAt = new Date("2026-01-01T00:00:00.000Z");

function statement(uuid: string, fact: string, invalid = false) {
  return {
    uuid,
    fact,
    aspect: "Identity",
    validAt,
    invalidAt: invalid ? new Date() : null,
  };
}

function voiceAspect(uuid: string, fact: string) {
  return { uuid, fact, aspect: "Preference", validAt, invalidAt: null };
}

function correction(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    status: "PROPOSED",
    action: "RETIRE",
    correctedText: null,
    statementIds: ["s1"],
    voiceAspectIds: ["v1"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  statementMock.findSimilarStatements.mockResolvedValue([]);
  aspectMock.findSimilarVoiceAspects.mockResolvedValue([]);
  aspectMock.getVoiceAspectsByIds.mockResolvedValue([]);
  prismaMock.memoryCorrection.create.mockImplementation(async ({ data }) => ({
    id: "c-1",
    ...data,
  }));
});

describe("findFacts", () => {
  it("returns current statements and voice aspects, skipping retired ones", async () => {
    statementMock.findSimilarStatements.mockResolvedValue([
      statement("s1", "User lives in Pune"),
      statement("s2", "User lives in Delhi", true),
    ]);
    aspectMock.findSimilarVoiceAspects.mockResolvedValue([
      { ...voiceAspect("v1", "Prefers tea"), score: 0.7 },
    ]);

    const facts = await findFacts({ ...scope, query: "where the user lives" });

    expect(facts.map((f) => [f.id, f.kind])).toEqual([
      ["s1", "statement"],
      ["v1", "voice_aspect"],
    ]);
  });

  it("rejects an empty query", async () => {
    await expect(findFacts({ ...scope, query: "  " })).rejects.toBeInstanceOf(
      MemoryCorrectionError,
    );
  });
});

describe("proposeCorrection", () => {
  it("stages a PROPOSED correction with a snapshot of the facts", async () => {
    statementMock.getStatements.mockResolvedValue([
      statement("s1", "User lives in Delhi"),
    ]);
    aspectMock.getVoiceAspectsByIds.mockResolvedValue([
      voiceAspect("v1", "Prefers coffee"),
    ]);

    const { correction: created } = await proposeCorrection({
      ...scope,
      action: "RETIRE" as never,
      statementIds: ["s1", "s1"],
      voiceAspectIds: ["v1"],
      reason: " outdated ",
      proposedBy: "user",
    });

    const data = prismaMock.memoryCorrection.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: "PROPOSED",
      action: "RETIRE",
      reason: "outdated",
      correctedText: null,
      statementIds: ["s1"],
      voiceAspectIds: ["v1"],
      proposedBy: "user",
      ...scope,
    });
    expect(data.facts).toEqual([
      {
        id: "s1",
        kind: "statement",
        fact: "User lives in Delhi",
        aspect: "Identity",
      },
      {
        id: "v1",
        kind: "voice_aspect",
        fact: "Prefers coffee",
        aspect: "Preference",
      },
    ]);
    expect(created.id).toBe("c-1");
    // Staging only: nothing is retired yet.
    expect(statementMock.invalidateStatementsBatch).not.toHaveBeenCalled();
    expect(aspectMock.invalidateVoiceAspects).not.toHaveBeenCalled();
  });

  it("returns similar current facts from the sweep, excluding the targets", async () => {
    statementMock.getStatements.mockResolvedValue([
      statement("s1", "User lives in Delhi"),
    ]);
    statementMock.findSimilarStatements.mockResolvedValue([
      statement("s1", "User lives in Delhi"),
      statement("s3", "User's home city is Delhi"),
      statement("s4", "User lived in Delhi in 2019", true),
    ]);

    const { similar } = await proposeCorrection({
      ...scope,
      action: "RETIRE" as never,
      statementIds: ["s1"],
      proposedBy: "agent",
    });

    expect(similar.map((f) => f.id)).toEqual(["s3"]);
  });

  it("keeps the proposal when the sweep fails", async () => {
    statementMock.getStatements.mockResolvedValue([
      statement("s1", "User lives in Delhi"),
    ]);
    statementMock.findSimilarStatements.mockRejectedValue(
      new Error("vector down"),
    );

    const result = await proposeCorrection({
      ...scope,
      action: "RETIRE" as never,
      statementIds: ["s1"],
      proposedBy: "user",
    });

    expect(result.correction.id).toBe("c-1");
    expect(result.similar).toEqual([]);
  });

  it("refuses facts that are missing or already retired", async () => {
    statementMock.getStatements.mockResolvedValue([
      statement("s1", "User lives in Delhi", true),
    ]);

    await expect(
      proposeCorrection({
        ...scope,
        action: "RETIRE" as never,
        statementIds: ["s1", "s-missing"],
        proposedBy: "user",
      }),
    ).rejects.toMatchObject({ code: "FACTS_NOT_CURRENT" });
    expect(prismaMock.memoryCorrection.create).not.toHaveBeenCalled();
  });

  it("requires ids, and corrected text for CORRECT", async () => {
    await expect(
      proposeCorrection({
        ...scope,
        action: "RETIRE" as never,
        proposedBy: "user",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      proposeCorrection({
        ...scope,
        action: "CORRECT" as never,
        statementIds: ["s1"],
        correctedText: "   ",
        proposedBy: "user",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("applyCorrection", () => {
  it("retires the facts tagged with the correction id", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(
      correction({ status: "APPLIED" }),
    );
    prismaMock.memoryCorrection.update.mockResolvedValue(
      correction({ status: "APPLIED" }),
    );
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);

    const result = await applyCorrection({ ...scope, id: "c-1" });

    expect(prismaMock.memoryCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", ...scope, status: "PROPOSED" },
      data: expect.objectContaining({ status: "APPLIED" }),
    });
    expect(statementMock.invalidateStatementsBatch).toHaveBeenCalledWith({
      statementIds: ["s1"],
      invalidatedBy: "correction:c-1",
      ...scope,
    });
    expect(aspectMock.invalidateVoiceAspects).toHaveBeenCalledWith({
      ids: ["v1"],
      invalidatedBy: "correction:c-1",
      ...scope,
    });
    expect(addToQueue).not.toHaveBeenCalled();
    expect(result.retiredStatementIds).toEqual(["s1"]);
    expect(result.retiredVoiceAspectCount).toBe(1);
  });

  it("ingests only the corrected text for CORRECT", async () => {
    const applied = correction({
      status: "APPLIED",
      action: "CORRECT",
      correctedText: "User lives in Pune",
    });
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(applied);
    prismaMock.memoryCorrection.update.mockResolvedValue(applied);
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    addToQueue.mockResolvedValue({ id: "queue-1" });

    await applyCorrection({ ...scope, id: "c-1" });

    const [body, userId, workspaceId] = addToQueue.mock.calls[0];
    expect(body).toMatchObject({
      episodeBody: "Correction from the user: User lives in Pune",
      source: "correction",
      metadata: { correctionId: "c-1" },
    });
    expect([userId, workspaceId]).toEqual(["user-1", "ws-1"]);
    expect(prismaMock.memoryCorrection.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { ingestionQueueId: "queue-1" },
    });
  });

  it("rolls back retirements and status when ingestion fails", async () => {
    const applied = correction({
      status: "APPLIED",
      action: "CORRECT",
      correctedText: "User lives in Pune",
    });
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(applied);
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    addToQueue.mockRejectedValue(new Error("no credits"));

    await expect(applyCorrection({ ...scope, id: "c-1" })).rejects.toThrow(
      "no credits",
    );

    expect(statementMock.restoreInvalidatedStatements).toHaveBeenCalledWith({
      statementIds: ["s1"],
      invalidatedBy: "correction:c-1",
      ...scope,
    });
    expect(aspectMock.restoreVoiceAspects).toHaveBeenCalledWith({
      ids: ["v1"],
      invalidatedBy: "correction:c-1",
      ...scope,
    });
    expect(prismaMock.memoryCorrection.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { status: "PROPOSED", appliedAt: null },
    });
  });

  it("refuses a correction that is not PROPOSED", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(
      correction({ status: "APPLIED" }),
    );

    await expect(
      applyCorrection({ ...scope, id: "c-1" }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(statementMock.invalidateStatementsBatch).not.toHaveBeenCalled();
  });

  it("reports an unknown correction as NOT_FOUND", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(null);

    await expect(
      applyCorrection({ ...scope, id: "nope" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("rejectCorrection", () => {
  it("moves PROPOSED to REJECTED without touching memory", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(
      correction({ status: "REJECTED" }),
    );

    const rejected = await rejectCorrection({ ...scope, id: "c-1" });

    expect(rejected.status).toBe("REJECTED");
    expect(prismaMock.memoryCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", ...scope, status: "PROPOSED" },
      data: expect.objectContaining({ status: "REJECTED" }),
    });
    expect(statementMock.invalidateStatementsBatch).not.toHaveBeenCalled();
  });
});

describe("restoreCorrection", () => {
  it("restores only facts retired by this correction", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(
      correction({ status: "RESTORED" }),
    );
    statementMock.restoreInvalidatedStatements.mockResolvedValue(["s1"]);
    aspectMock.restoreVoiceAspects.mockResolvedValue(1);

    const result = await restoreCorrection({ ...scope, id: "c-1" });

    expect(prismaMock.memoryCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", ...scope, status: "APPLIED" },
      data: expect.objectContaining({ status: "RESTORED" }),
    });
    expect(statementMock.restoreInvalidatedStatements).toHaveBeenCalledWith({
      statementIds: ["s1"],
      invalidatedBy: correctionTag("c-1"),
      ...scope,
    });
    expect(result.restoredStatementIds).toEqual(["s1"]);
    expect(result.restoredVoiceAspectCount).toBe(1);
  });

  it("goes back to APPLIED when the restore fails", async () => {
    prismaMock.memoryCorrection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.memoryCorrection.findFirst.mockResolvedValue(
      correction({ status: "RESTORED" }),
    );
    statementMock.restoreInvalidatedStatements.mockRejectedValue(
      new Error("neo4j down"),
    );

    await expect(restoreCorrection({ ...scope, id: "c-1" })).rejects.toThrow(
      "neo4j down",
    );
    expect(prismaMock.memoryCorrection.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { status: "APPLIED", restoredAt: null },
    });
  });
});
