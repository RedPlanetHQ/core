import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/db.server", () => ({
  prisma: {
    conversationHistory: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));
vi.mock("../conversation.server", () => ({
  createConversation: vi.fn(),
}));
vi.mock("~/models/user.server", () => ({
  getUserTimezone: vi.fn().mockResolvedValue("UTC"),
}));
vi.mock("~/services/channels/whatsapp/utils", () => ({
  formatDailyWhatsAppTitle: vi.fn().mockReturnValue("title"),
}));

import { prisma } from "~/db.server";
import { getOrCreateChannelConversation } from "../message-processor";

describe("getOrCreateChannelConversation — Slack thread routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a thread reply to the task conversation via slackTs", async () => {
    (prisma.conversationHistory.findFirst as any).mockResolvedValue({
      conversationId: "taskConv1",
    });

    const id = await getOrCreateChannelConversation(
      "user1",
      "ws1",
      "different recipe please",
      "slack",
      { threadTs: "1700000000.000100" },
    );

    expect(id).toBe("taskConv1");
    expect(prisma.conversationHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          context: { path: ["slackTs"], equals: "1700000000.000100" },
          conversation: { userId: "user1", deleted: null },
        }),
      }),
    );
    // Did NOT fall through to daily-bucket lookup
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  it("falls through to existing behavior when no slackTs match", async () => {
    (prisma.conversationHistory.findFirst as any).mockResolvedValue(null);
    (prisma.conversation.findFirst as any).mockResolvedValue({ id: "dailyConv1" });

    const id = await getOrCreateChannelConversation(
      "user1",
      "ws1",
      "hello",
      "slack",
      { threadTs: "1700000000.999999" },
    );

    expect(id).toBe("dailyConv1");
  });
});
