/**
 * Conversation row events go out on exactly one transport: a PUBLISH onto
 * the app's Redis.
 *
 * That only holds because every caller of `upsertConversationHistory` runs
 * in the webapp process or a BullMQ worker, which share that Redis — see
 * `~/bullmq/workers/always-on`. A publisher on a different Redis (what a
 * trigger.dev worker would be) succeeds and reaches nobody, which surfaces
 * as "conversation stuck on Working…, refresh shows the reply".
 *
 * The publish must also stay fire-and-forget, so a Redis outage can never
 * fail the DB write that preceded it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishMock, duplicateMock, loggerMock } = vi.hoisted(() => {
  const publish = vi.fn<(...args: any[]) => Promise<number>>(async () => 1);
  const publisher = { publish, on: vi.fn() };
  return {
    publishMock: publish,
    duplicateMock: vi.fn(() => publisher),
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock("~/bullmq/connection", () => ({
  getRedisConnection: () => ({ duplicate: duplicateMock }),
}));
vi.mock("~/services/logger.service", () => ({ logger: loggerMock }));

import {
  publishRowEvent,
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

beforeEach(() => {
  vi.clearAllMocks();
  publishMock.mockResolvedValue(1);
  vi.stubGlobal("fetch", fetchMock);
});

describe("publishRowEvent", () => {
  it("publishes the envelope on the conversation's channel", async () => {
    await publishRowEvent(event);

    expect(publishMock).toHaveBeenCalledWith(
      "conv:conv-1",
      JSON.stringify(event),
    );
  });

  it("makes no network call — Redis is the only transport", async () => {
    await publishRowEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the subscriber count, the signal for 'pubsub isn't wired right'", async () => {
    publishMock.mockResolvedValue(3);

    await publishRowEvent(event);

    expect(loggerMock.info).toHaveBeenCalledWith(
      "conversation-pubsub publish",
      expect.objectContaining({
        conversationId: "conv-1",
        rowId: "row-1",
        status: "done",
        receiverCount: 3,
      }),
    );
  });

  it("swallows a Redis failure instead of failing the caller's write", async () => {
    publishMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(publishRowEvent(event)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "conversation-pubsub publish failed",
      expect.objectContaining({ conversationId: "conv-1", rowId: "row-1" }),
    );
  });
});
