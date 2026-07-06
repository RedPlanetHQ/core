/**
 * Unit tests for the daily token usage rollup.
 *
 * Two layers:
 *   - buildUsageRow (pure): all the derivations — clamping, empty-string ↔
 *     null coercion, "" defaults, UTC day bucketing. Fast, no DB.
 *   - recordTokenUsage (integration-ish): mocks $executeRaw, verifies the
 *     SQL parameters make it through in the right positions and that DB
 *     errors get swallowed instead of thrown.
 *
 * pickAgentResultTokens covers the chat-hook wire-picking logic — Mastra's
 * `usage` is last-step-only so callers must prefer `totalUsage` to avoid
 * undercounting tool-loop turns by 5-10x.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeRawMock, loggerMock } = vi.hoisted(() => ({
  executeRawMock: vi.fn<(...args: any[]) => Promise<any>>(async () => 1),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn<(msg: string, ctx?: any) => void>(),
    error: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  prisma: { $executeRaw: executeRawMock },
}));
vi.mock("~/services/logger.service", () => ({ logger: loggerMock }));

import {
  buildUsageRow,
  pickAgentResultTokens,
  recordTokenUsage,
} from "../tokenUsage.server";

const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

beforeEach(() => {
  executeRawMock.mockClear();
  executeRawMock.mockResolvedValue(1);
  loggerMock.warn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildUsageRow", () => {
  it("normalizes real ingestion input into the DB row shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:15:00Z"));

    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "memory_ingestion",
      inputTokens: 1234,
      outputTokens: 567,
      model: "claude-sonnet-4-6",
      operationKey: "reflect-world",
    });

    expect(row).toEqual({
      date: utcDay(new Date("2026-07-06T10:15:00Z")),
      workspaceId: "ws-1",
      userId: "u-1",
      source: "memory_ingestion",
      model: "claude-sonnet-4-6",
      operationKey: "reflect-world",
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
    });
  });

  it("returns null when both token counts are zero (row would be a no-op)", () => {
    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(row).toBeNull();
  });

  it("defaults model and operationKey to '' so unique-key dedupe is deterministic", () => {
    // Callers that don't know the model (or don't specify an operation) still
    // dedupe into a single per-day bucket instead of NULL-vs-NULL confusion.
    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "memory_ingestion",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(row?.model).toBe("");
    expect(row?.operationKey).toBe("");
  });

  it("routes operationKey verbatim into the row (the per-prompt breakdown)", () => {
    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "background",
      inputTokens: 900,
      outputTokens: 100,
      operationKey: "session-compaction",
    });
    expect(row?.operationKey).toBe("session-compaction");
    expect(row?.source).toBe("background");
  });

  it("coerces missing / empty userId to null (so the FK stores real NULL)", () => {
    expect(
      buildUsageRow({
        workspaceId: "ws-1",
        userId: null,
        source: "background",
        inputTokens: 100,
        outputTokens: 50,
      })?.userId,
    ).toBeNull();
    expect(
      buildUsageRow({
        workspaceId: "ws-1",
        userId: "",
        source: "background",
        inputTokens: 100,
        outputTokens: 50,
      })?.userId,
    ).toBeNull();
    expect(
      buildUsageRow({
        workspaceId: "ws-1",
        userId: undefined,
        source: "background",
        inputTokens: 100,
        outputTokens: 50,
      })?.userId,
    ).toBeNull();
  });

  it("clamps negatives and non-integers before writing", () => {
    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: -5,
      outputTokens: 12.7,
    });
    expect(row?.inputTokens).toBe(0);
    expect(row?.outputTokens).toBe(12);
    expect(row?.totalTokens).toBe(12);
  });

  it("buckets by UTC day (not local time)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T23:30:00Z"));
    const row = buildUsageRow({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(row?.date.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });
});

describe("recordTokenUsage", () => {
  it("executes one raw INSERT ... ON CONFLICT statement per call", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "background",
      inputTokens: 900,
      outputTokens: 100,
      operationKey: "reflect-world",
      model: "claude-sonnet-4-6",
    });

    expect(executeRawMock).toHaveBeenCalledOnce();
    // First arg is the template-string array; the rest are the interpolated
    // values, in order: date, source, model, operationKey, inTok, outTok,
    // total, workspaceId, userId.
    const args = executeRawMock.mock.calls[0];
    const values = args.slice(1);
    expect(values).toContain("background");
    expect(values).toContain("reflect-world");
    expect(values).toContain("claude-sonnet-4-6");
    expect(values).toContain("ws-1");
    expect(values).toContain("u-1");
    expect(values).toContain(900);
    expect(values).toContain(100);
    expect(values).toContain(1000); // total
  });

  it("passes null through for background rows without a user actor", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: null,
      source: "background",
      inputTokens: 400,
      outputTokens: 60,
      operationKey: "session-compaction",
    });

    const values = executeRawMock.mock.calls[0].slice(1);
    // The last positional value is userId — asserted as null so it hits the
    // DB as a real NULL and dedupes via NULLS NOT DISTINCT.
    expect(values[values.length - 1]).toBeNull();
  });

  it("skips the SQL entirely when both token counts are zero", async () => {
    await recordTokenUsage({
      workspaceId: "ws-1",
      userId: "u-1",
      source: "conversation",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("swallows DB errors and logs a warning (never breaks the request path)", async () => {
    executeRawMock.mockRejectedValueOnce(new Error("boom"));

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
