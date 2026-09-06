/**
 * Auth and validation for the trigger.dev → webapp pubsub bridge.
 *
 * This route is the one place a process outside the webapp can push onto
 * `conv:{conversationId}`, so the shared-secret check is the whole
 * security boundary — it gets tested harder than the happy path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishToRedisMock, loggerMock, envMock } = vi.hoisted(() => ({
  publishToRedisMock: vi.fn<(...args: any[]) => Promise<number>>(async () => 2),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  envMock: { INTERNAL_EVENTS_SECRET: "s3cret" as string | undefined },
}));

vi.mock("~/env.server", () => ({ env: envMock }));
vi.mock("~/services/logger.service", () => ({ logger: loggerMock }));
vi.mock("~/services/conversation-pubsub.server", () => ({
  publishRowEventToRedis: publishToRedisMock,
}));

import { action } from "../api.v1.internal.conversation-events";

const event = {
  type: "row-upsert",
  rowId: "row-1",
  conversationId: "conv-1",
  agentId: "agent-1",
  status: "done",
  ts: 1_700_000_000_000,
};

function post(
  body: unknown,
  { secret, method = "POST" }: { secret?: string; method?: string } = {
    secret: "s3cret",
  },
) {
  return new Request("https://app.example.com/api/v1/internal/conversation-events", {
    method,
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const run = (request: Request) =>
  action({ request, params: {}, context: {} } as any);

beforeEach(() => {
  vi.clearAllMocks();
  publishToRedisMock.mockResolvedValue(2);
  envMock.INTERNAL_EVENTS_SECRET = "s3cret";
});

describe("POST /api/v1/internal/conversation-events", () => {
  it("publishes the envelope and returns the receiver count", async () => {
    const res = await run(post(event, { secret: "s3cret" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, receiverCount: 2 });
    expect(publishToRedisMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", rowId: "row-1" }),
    );
  });

  it("rejects a wrong secret", async () => {
    const res = await run(post(event, { secret: "wrong-length-secret" }));

    expect(res.status).toBe(401);
    expect(publishToRedisMock).not.toHaveBeenCalled();
  });

  it("rejects a same-length-but-wrong secret", async () => {
    const res = await run(post(event, { secret: "s3cre7" }));

    expect(res.status).toBe(401);
    expect(publishToRedisMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    const res = await run(post(event, {}));

    expect(res.status).toBe(401);
    expect(publishToRedisMock).not.toHaveBeenCalled();
  });

  it("503s when the bridge secret is not configured on the server", async () => {
    envMock.INTERNAL_EVENTS_SECRET = undefined;

    const res = await run(post(event, { secret: "s3cret" }));

    expect(res.status).toBe(503);
    expect(publishToRedisMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const res = await run(post(event, { secret: "s3cret", method: "GET" }));

    expect(res.status).toBe(405);
  });

  it("400s on a malformed envelope", async () => {
    const res = await run(
      post({ type: "row-upsert", conversationId: "conv-1" }, { secret: "s3cret" }),
    );

    expect(res.status).toBe(400);
    expect(publishToRedisMock).not.toHaveBeenCalled();
  });

  it("400s on a body that isn't JSON", async () => {
    const request = new Request(
      "https://app.example.com/api/v1/internal/conversation-events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer s3cret",
        },
        body: "not json",
      },
    );

    const res = await run(request);

    expect(res.status).toBe(400);
  });

  it("500s when the publish fails, so the failure lands in both logs", async () => {
    publishToRedisMock.mockRejectedValue(new Error("redis down"));

    const res = await run(post(event, { secret: "s3cret" }));

    expect(res.status).toBe(500);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "internal conversation-events: publish failed",
      expect.objectContaining({ conversationId: "conv-1" }),
    );
  });
});
