/**
 * Transport selection for conversation row events.
 *
 * The bug this guards: trigger.dev workers run against their own Redis,
 * so a direct PUBLISH from a job succeeds and reaches nobody — the UI
 * sits on "Working…" until you refresh. `publishRowEvent` must pick the
 * HTTP bridge in that runtime and plain Redis everywhere else, and must
 * stay fire-and-forget on both branches so a transport outage can never
 * fail the DB write that preceded it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishMock, duplicateMock, loggerMock, envMock, runtimeMock } =
  vi.hoisted(() => {
    const publish = vi.fn<(...args: any[]) => Promise<number>>(async () => 1);
    const publisher = { publish, on: vi.fn() };
    return {
      publishMock: publish,
      duplicateMock: vi.fn(() => publisher),
      loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      envMock: {
        APP_ORIGIN: "https://app.example.com",
        INTERNAL_EVENTS_SECRET: "s3cret" as string | undefined,
      },
      runtimeMock: { inTrigger: false },
    };
  });

vi.mock("~/bullmq/connection", () => ({
  getRedisConnection: () => ({ duplicate: duplicateMock }),
}));
vi.mock("~/services/logger.service", () => ({ logger: loggerMock }));
vi.mock("~/env.server", () => ({ env: envMock }));
vi.mock("~/lib/runtime.server", () => ({
  isRunningInTrigger: () => runtimeMock.inTrigger,
}));

import {
  INTERNAL_EVENTS_PATH,
  publishRowEvent,
  publishRowEventToRedis,
  type ConversationRowEvent,
} from "../conversation-pubsub.server";

const event: ConversationRowEvent = {
  type: "row-upsert",
  rowId: "row-1",
  conversationId: "conv-1",
  agentId: "agent-1",
  status: "done",
  ts: 1_700_000_000_000,
};

const fetchMock = vi.fn<(...args: any[]) => Promise<any>>();

const okResponse = (body: unknown = { ok: true, receiverCount: 2 }) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => body,
});

beforeEach(() => {
  vi.clearAllMocks();
  publishMock.mockResolvedValue(1);
  envMock.APP_ORIGIN = "https://app.example.com";
  envMock.INTERNAL_EVENTS_SECRET = "s3cret";
  runtimeMock.inTrigger = false;
  fetchMock.mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

describe("publishRowEvent — webapp / BullMQ runtime", () => {
  it("publishes straight onto Redis and never calls the bridge", async () => {
    await publishRowEvent(event);

    expect(publishMock).toHaveBeenCalledWith(
      "conv:conv-1",
      JSON.stringify(event),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      "conversation-pubsub publish",
      expect.objectContaining({ transport: "redis", receiverCount: 1 }),
    );
  });

  it("swallows a Redis failure instead of failing the caller's write", async () => {
    publishMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(publishRowEvent(event)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "conversation-pubsub publish failed",
      expect.objectContaining({ transport: "redis" }),
    );
  });
});

describe("publishRowEvent — trigger.dev runtime", () => {
  beforeEach(() => {
    runtimeMock.inTrigger = true;
  });

  it("POSTs the envelope to the webapp instead of its own Redis", async () => {
    await publishRowEvent(event);

    expect(publishMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://app.example.com${INTERNAL_EVENTS_PATH}`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer s3cret");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(event);
    // A worker blocked on a publish is a worker not finishing its run.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("relays the receiver count the webapp reports back", async () => {
    fetchMock.mockResolvedValue(okResponse({ ok: true, receiverCount: 3 }));

    await publishRowEvent(event);

    expect(loggerMock.info).toHaveBeenCalledWith(
      "conversation-pubsub publish",
      expect.objectContaining({ transport: "http", receiverCount: 3 }),
    );
  });

  it("does not double up slashes when APP_ORIGIN has a trailing one", async () => {
    envMock.APP_ORIGIN = "https://app.example.com/";

    await publishRowEvent(event);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://app.example.com${INTERNAL_EVENTS_PATH}`,
    );
  });

  it("names itself in the logs when the shared secret is missing", async () => {
    envMock.INTERNAL_EVENTS_SECRET = undefined;

    await publishRowEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("INTERNAL_EVENTS_SECRET unset"),
      expect.objectContaining({ conversationId: "conv-1" }),
    );
  });

  it("swallows a non-2xx bridge response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    });

    await expect(publishRowEvent(event)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "conversation-pubsub publish failed",
      expect.objectContaining({ transport: "http" }),
    );
  });

  it("swallows a bridge that is unreachable entirely", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));

    await expect(publishRowEvent(event)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});

describe("publishRowEventToRedis", () => {
  it("returns the subscriber count and propagates errors to its caller", async () => {
    publishMock.mockResolvedValue(4);
    await expect(publishRowEventToRedis(event)).resolves.toBe(4);

    publishMock.mockRejectedValue(new Error("down"));
    await expect(publishRowEventToRedis(event)).rejects.toThrow("down");
  });

  it("stays on Redis even inside the trigger runtime, so the route can't loop", async () => {
    runtimeMock.inTrigger = true;

    await publishRowEventToRedis(event);

    expect(publishMock).toHaveBeenCalledWith(
      "conv:conv-1",
      JSON.stringify(event),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
