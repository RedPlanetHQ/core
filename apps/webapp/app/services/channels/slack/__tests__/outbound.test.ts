import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/db.server", () => ({
  prisma: {
    channel: { findFirst: vi.fn() },
  },
}));

import { prisma } from "~/db.server";
import { sendReply } from "../outbound";

describe("slack outbound sendReply", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns the posted message ts for a DM", async () => {
    (prisma.channel.findFirst as any).mockResolvedValue({
      id: "ch1",
      config: { bot_token: "xoxb-test" },
    });

    // conversations.open then chat.postMessage
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, channel: { id: "D123" } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, ts: "1700000000.000100" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReply("U123", "hello", { workspaceId: "ws1" });

    expect(result).toEqual({ ts: "1700000000.000100" });
  });

  it("threads the DM reply under threadTs when the inbound was a thread reply", async () => {
    (prisma.channel.findFirst as any).mockResolvedValue({
      id: "ch1",
      config: { bot_token: "xoxb-test" },
    });

    // conversations.open then chat.postMessage
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, channel: { id: "D123" } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, ts: "1700000000.000200" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await sendReply("U123", "different recipe", {
      workspaceId: "ws1",
      threadTs: "1700000000.000100",
    });

    // The chat.postMessage call (second fetch) must carry thread_ts
    const postCall = fetchMock.mock.calls[1];
    const postBody = JSON.parse(postCall[1].body);
    expect(postBody.thread_ts).toBe("1700000000.000100");
  });

  it("does NOT thread a plain DM reply when no threadTs is present", async () => {
    (prisma.channel.findFirst as any).mockResolvedValue({
      id: "ch1",
      config: { bot_token: "xoxb-test" },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, channel: { id: "D123" } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, ts: "1700000000.000300" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await sendReply("U123", "hello", { workspaceId: "ws1" });

    const postBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(postBody.thread_ts).toBeUndefined();
  });
});
