/**
 * Unit tests for the daily token usage rollup.
 *
 * Verifies that recordTokenUsage:
 *   - upserts into the correct (date, userId, workspaceId, source, model) bucket
 *   - passes real inputTokens/outputTokens through to the DB (no dropped fields)
 *   - increments by the right amounts on the update branch
 *   - skips writing when both token counts are zero (so we don't spam rows
 *     with no signal)
 *   - swallows DB errors — usage recording must never break the request path
 *
 * Prisma is mocked because the important behavior is the shape of the upsert
 * call. Integration against the real DB is covered separately by the
 * task-lifecycle test's pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above top-level consts, so use vi.hoisted for shared
// mock state — matches the pattern in task-lifecycle.test.ts.
const { upsertMock, loggerMock } = vi.hoisted(() => ({
  upsertMock: vi.fn<(args: any) => Promise<any>>(async () => ({})),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn<(msg: string, ctx?: any) => void>(),
    error: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  prisma: { dailyTokenUsage: { upsert: upsertMock } },
}));
vi.mock("~/services/logger.service", () => ({ logger: loggerMock }));

import {
  pickAgentResultTokens,
  recordTokenUsage,
} from "../tokenUsage.server";

const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

beforeEach(() => {
  upsertMock.mockClear();
  loggerMock.warn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordTokenUsage", () => {
  it("upserts a memory_ingestion row with real input/output tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:15:00Z"));

    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "memory_ingestion",
      inputTokens: 1234,
      outputTokens: 567,
      model: "claude-sonnet-4-6",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];

    // Bucket key is (date, userId, workspaceId, source, model)
    expect(call.where.date_userId_workspaceId_source_model).toEqual({
      date: utcDay(new Date("2026-07-06T10:15:00Z")),
      userId: "u-1",
      workspaceId: "ws-1",
      source: "memory_ingestion",
      model: "claude-sonnet-4-6",
    });

    // Create branch: real tokens land verbatim; totalTokens = input + output;
    // eventCount starts at 1.
    expect(call.create).toMatchObject({
      source: "memory_ingestion",
      model: "claude-sonnet-4-6",
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1234 + 567,
      eventCount: 1,
    });

    // Update branch: atomic increments so concurrent calls collapse.
    expect(call.update).toEqual({
      inputTokens: { increment: 1234 },
      outputTokens: { increment: 567 },
      totalTokens: { increment: 1234 + 567 },
      eventCount: { increment: 1 },
    });
  });

  it("distinguishes conversation from task_conversation buckets", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 100,
      outputTokens: 50,
    });
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "task_conversation",
      inputTokens: 200,
      outputTokens: 60,
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const first = upsertMock.mock.calls[0][0];
    const second = upsertMock.mock.calls[1][0];
    expect(first.where.date_userId_workspaceId_source_model.source).toBe(
      "conversation",
    );
    expect(second.where.date_userId_workspaceId_source_model.source).toBe(
      "task_conversation",
    );
  });

  it("defaults model to '' so the unique key stays deterministic", async () => {
    // Graph resolution doesn't pass a model — must map to "" not null so the
    // Postgres unique constraint dedupes across concurrent calls.
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "memory_ingestion",
      inputTokens: 10,
      outputTokens: 5,
    });

    const call = upsertMock.mock.calls[0][0];
    expect(call.where.date_userId_workspaceId_source_model.model).toBe("");
    expect(call.create.model).toBe("");
  });

  it("skips writing when both token counts are zero", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("clamps negatives and non-integers, still writes when total > 0", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: -5,
      outputTokens: 12.7,
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create.inputTokens).toBe(0);
    expect(call.create.outputTokens).toBe(12);
    expect(call.create.totalTokens).toBe(12);
  });

  it("swallows Prisma errors and logs a warning instead of throwing", async () => {
    upsertMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      recordTokenUsage({
        workspaceId: "ws-1",
        userId: "u-1",
        source: "conversation",
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).resolves.toBeUndefined();

    expect(loggerMock.warn).toHaveBeenCalledOnce();
    const [msg, ctx] = loggerMock.warn.mock.calls[0];
    expect(msg).toBe("recordTokenUsage failed");
    expect(ctx.error).toBeInstanceOf(Error);
  });

  // Regression tests for the no-stream-process hook: prefer totalUsage over
  // usage because the butler runs a tool loop (stepCountIs(10)) and Mastra's
  // `usage` is only the last step. Getting this wrong undercounts every
  // tool-using turn by 5-10x.
  describe("pickAgentResultTokens", () => {
    it("prefers totalUsage over usage", () => {
      const tokens = pickAgentResultTokens({
        usage: { inputTokens: 100, outputTokens: 50 },
        totalUsage: { inputTokens: 800, outputTokens: 400 },
      });
      expect(tokens).toEqual({ inputTokens: 800, outputTokens: 400 });
    });

    it("falls back to usage when totalUsage is absent", () => {
      const tokens = pickAgentResultTokens({
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      expect(tokens).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it("returns zeros when both are missing", () => {
      expect(pickAgentResultTokens({})).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(pickAgentResultTokens(null)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(pickAgentResultTokens(undefined)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it("coerces string usage numbers (defensive against provider variance)", () => {
      const tokens = pickAgentResultTokens({
        totalUsage: { inputTokens: "1200" as any, outputTokens: "300" as any },
      });
      expect(tokens).toEqual({ inputTokens: 1200, outputTokens: 300 });
    });
  });

  it("buckets by UTC day (not local time)", async () => {
    vi.useFakeTimers();
    // 11:30 PM UTC on July 6 → UTC day should still be July 6.
    vi.setSystemTime(new Date("2026-07-06T23:30:00Z"));

    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 1,
      outputTokens: 1,
    });

    const call = upsertMock.mock.calls[0][0];
    const date = call.where.date_userId_workspaceId_source_model.date as Date;
    expect(date.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });
});
