import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
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
    APPLYING: "APPLYING",
    APPLIED: "APPLIED",
    REJECTED: "REJECTED",
    RESTORING: "RESTORING",
    RESTORED: "RESTORED",
    FAILED: "FAILED",
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

import { getEmbedding } from "~/lib/model.server";
import {
  applyCorrection,
  correctionTag,
  findFacts,
  MemoryCorrectionError,
  proposeCorrection,
  rejectCorrection,
  restoreCorrection,
  STALE_IN_PROGRESS_MS,
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
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
    Promise.all(ops),
  );
  vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2]);
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

/** Make the claim step (transition) succeed and return `record`. */
function claimSucceeds(record: Record<string, unknown>) {
  prismaMock.memoryCorrection.updateMany.mockResolvedValueOnce({ count: 1 });
  prismaMock.memoryCorrection.findFirst.mockResolvedValueOnce(record);
}

/** Make the claim step find the record in another state. */
function claimRefused(record: Record<string, unknown> | null) {
  prismaMock.memoryCorrection.updateMany.mockResolvedValueOnce({ count: 0 });
  prismaMock.memoryCorrection.findFirst.mockResolvedValueOnce(record);
}

function lastStatusWrite() {
  const calls = prismaMock.memoryCorrection.update.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe("applyCorrection", () => {
  it("claims PROPOSED → APPLYING atomically, retires, then marks APPLIED", async () => {
    claimSucceeds(correction({ status: "APPLYING" }));
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    prismaMock.memoryCorrection.update.mockResolvedValue(
      correction({ status: "APPLIED" }),
    );

    const result = await applyCorrection({ ...scope, id: "c-1" });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.memoryCorrection.updateMany).toHaveBeenCalledWith({
      where: {
        id: "c-1",
        ...scope,
        OR: [{ status: { in: ["PROPOSED"] } }],
      },
      data: { status: "APPLYING" },
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
    expect(lastStatusWrite()).toEqual({
      where: { id: "c-1" },
      data: {
        status: "APPLIED",
        appliedAt: expect.any(Date),
        ingestionQueueId: null,
      },
    });
    expect(result.retiredStatementIds).toEqual(["s1"]);
    expect(result.retiredVoiceAspectCount).toBe(1);
  });

  it("ingests only the corrected text and stores the IngestionQueue row id", async () => {
    claimSucceeds(
      correction({
        status: "APPLYING",
        action: "CORRECT",
        correctedText: "User lives in Pune",
      }),
    );
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    addToQueue.mockResolvedValue({ id: "run-1", ingestionQueueId: "queue-1" });
    prismaMock.memoryCorrection.update.mockResolvedValue(
      correction({ status: "APPLIED" }),
    );

    await applyCorrection({ ...scope, id: "c-1" });

    const [body, userId, workspaceId] = addToQueue.mock.calls[0];
    expect(body).toMatchObject({
      episodeBody: "Correction from the user: User lives in Pune",
      source: "correction",
      metadata: { correctionId: "c-1" },
    });
    expect([userId, workspaceId]).toEqual(["user-1", "ws-1"]);
    expect(lastStatusWrite().data.ingestionQueueId).toBe("queue-1");
  });

  it("rolls back and returns to PROPOSED when ingestion fails", async () => {
    claimSucceeds(
      correction({
        status: "APPLYING",
        action: "CORRECT",
        correctedText: "User lives in Pune",
      }),
    );
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    statementMock.restoreInvalidatedStatements.mockResolvedValue(["s1"]);
    aspectMock.restoreVoiceAspects.mockResolvedValue(1);
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
    expect(lastStatusWrite()).toEqual({
      where: { id: "c-1" },
      data: { status: "PROPOSED" },
    });
  });

  it("attempts every rollback step and marks FAILED when one fails", async () => {
    claimSucceeds(correction({ status: "APPLYING" }));
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockRejectedValue(new Error("pg down"));
    statementMock.restoreInvalidatedStatements.mockRejectedValue(
      new Error("neo4j down"),
    );
    aspectMock.restoreVoiceAspects.mockResolvedValue(0);

    await expect(applyCorrection({ ...scope, id: "c-1" })).rejects.toThrow(
      "pg down",
    );

    // The voice-aspect undo still runs after the statement undo failed.
    expect(aspectMock.restoreVoiceAspects).toHaveBeenCalled();
    expect(lastStatusWrite()).toEqual({
      where: { id: "c-1" },
      data: { status: "FAILED" },
    });
  });

  it("never rolls back once the corrected text is queued", async () => {
    claimSucceeds(
      correction({
        status: "APPLYING",
        action: "CORRECT",
        correctedText: "User lives in Pune",
      }),
    );
    statementMock.invalidateStatementsBatch.mockResolvedValue(["s1"]);
    aspectMock.invalidateVoiceAspects.mockResolvedValue(1);
    addToQueue.mockResolvedValue({ id: "run-1", ingestionQueueId: "queue-1" });
    prismaMock.memoryCorrection.update.mockRejectedValue(new Error("pg blip"));

    await expect(applyCorrection({ ...scope, id: "c-1" })).rejects.toThrow(
      "pg blip",
    );

    expect(statementMock.restoreInvalidatedStatements).not.toHaveBeenCalled();
    expect(aspectMock.restoreVoiceAspects).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledTimes(1);
  });

  it("refuses a correction that is not PROPOSED (e.g. being restored)", async () => {
    claimRefused(correction({ status: "RESTORING" }));

    await expect(
      applyCorrection({ ...scope, id: "c-1" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(statementMock.invalidateStatementsBatch).not.toHaveBeenCalled();
  });

  it("reports an unknown correction as NOT_FOUND", async () => {
    claimRefused(null);

    await expect(
      applyCorrection({ ...scope, id: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rejectCorrection", () => {
  it("moves PROPOSED to REJECTED without touching memory", async () => {
    claimSucceeds(correction({ status: "REJECTED" }));

    const rejected = await rejectCorrection({ ...scope, id: "c-1" });

    expect(rejected.status).toBe("REJECTED");
    expect(prismaMock.memoryCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", ...scope, OR: [{ status: { in: ["PROPOSED"] } }] },
      data: { status: "REJECTED", rejectedAt: expect.any(Date) },
    });
    expect(statementMock.invalidateStatementsBatch).not.toHaveBeenCalled();
  });
});

describe("restoreCorrection", () => {
  it("claims APPLIED/FAILED (or stale in-progress) → RESTORING, then RESTORED", async () => {
    claimSucceeds(correction({ status: "RESTORING" }));
    statementMock.restoreInvalidatedStatements.mockResolvedValue(["s1"]);
    aspectMock.restoreVoiceAspects.mockResolvedValue(1);
    prismaMock.memoryCorrection.update.mockResolvedValue(
      correction({ status: "RESTORED" }),
    );

    const result = await restoreCorrection({ ...scope, id: "c-1" });

    const where = prismaMock.memoryCorrection.updateMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: { in: ["APPLIED", "FAILED"] } });
    expect(where.OR[1].status).toEqual({ in: ["APPLYING", "RESTORING"] });
    const cutoff = where.OR[1].updatedAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(
      STALE_IN_PROGRESS_MS - 1000,
    );
    expect(statementMock.restoreInvalidatedStatements).toHaveBeenCalledWith({
      statementIds: ["s1"],
      invalidatedBy: correctionTag("c-1"),
      ...scope,
    });
    expect(lastStatusWrite()).toEqual({
      where: { id: "c-1" },
      data: { status: "RESTORED", restoredAt: expect.any(Date) },
    });
    expect(result.restoredStatementIds).toEqual(["s1"]);
    expect(result.restoredVoiceAspectCount).toBe(1);
  });

  it("refuses while an apply is in progress", async () => {
    claimRefused(correction({ status: "APPLYING" }));

    await expect(
      restoreCorrection({ ...scope, id: "c-1" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(statementMock.restoreInvalidatedStatements).not.toHaveBeenCalled();
  });

  it("attempts both stores and marks FAILED when one fails", async () => {
    claimSucceeds(correction({ status: "RESTORING" }));
    statementMock.restoreInvalidatedStatements.mockRejectedValue(
      new Error("neo4j down"),
    );
    aspectMock.restoreVoiceAspects.mockResolvedValue(1);

    await expect(
      restoreCorrection({ ...scope, id: "c-1" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    expect(aspectMock.restoreVoiceAspects).toHaveBeenCalled();
    expect(lastStatusWrite()).toEqual({
      where: { id: "c-1" },
      data: { status: "FAILED" },
    });
  });
});
