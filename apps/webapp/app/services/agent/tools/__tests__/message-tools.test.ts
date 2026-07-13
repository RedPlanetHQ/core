import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/db.server", () => ({
  prisma: {
    channel: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
    conversationHistory: { create: vi.fn() },
    voiceInboxMessage: { create: vi.fn() },
  },
}));
vi.mock("~/services/channel.server", () => ({
  getWorkspaceChannelContext: vi.fn(),
}));
vi.mock("~/services/agent/message-processor", () => ({
  getOrCreateChannelConversation: vi.fn(),
}));
vi.mock("~/services/conversation.server", () => ({
  upsertConversationHistory: vi.fn(),
}));

const sendReplyMock = vi.fn();
vi.mock("~/services/channels", () => ({
  getChannel: vi.fn(() => ({ sendReply: sendReplyMock })),
}));

import { prisma } from "~/db.server";
import { getMessageTools } from "../message-tools";

describe("send_message task threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors into the task conversation with slackTs when Slack returns a ts", async () => {
    (prisma.channel.findFirst as any).mockResolvedValue({
      id: "ch1",
      type: "slack",
      config: { user_id: "U123" },
    });
    (prisma.conversation.findFirst as any).mockResolvedValue({ id: "taskConv1" });
    (prisma.conversationHistory.create as any).mockResolvedValue({ id: "hist1" });
    (prisma.voiceInboxMessage.create as any).mockResolvedValue({ id: "inbox1" });
    sendReplyMock.mockResolvedValue({ ts: "1700000000.000100" });

    const tools = getMessageTools({
      workspaceId: "ws1",
      userId: "user1",
      userEmail: "u@example.com",
      triggerChannelId: "ch1",
      currentTaskId: "task1",
    });

    await (tools.send_message as any).execute({ message: "your keto recipe" });

    // Looked up the task conversation by asyncJobId=taskId
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          asyncJobId: "task1",
          userId: "user1",
          deleted: null,
        }),
      }),
    );

    // Wrote a history row into the task conversation carrying slackTs
    expect(prisma.conversationHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "taskConv1",
          context: { slackTs: "1700000000.000100" },
        }),
      }),
    );
  });

  it("falls back to daily-bucket mirror when there is no currentTaskId", async () => {
    (prisma.channel.findFirst as any).mockResolvedValue({
      id: "ch1",
      type: "slack",
      config: { user_id: "U123" },
    });
    (prisma.voiceInboxMessage.create as any).mockResolvedValue({ id: "inbox1" });
    sendReplyMock.mockResolvedValue({ ts: "1700000000.000200" });

    const { getOrCreateChannelConversation } = await import(
      "~/services/agent/message-processor"
    );
    (getOrCreateChannelConversation as any).mockResolvedValue("dailyConv1");

    const tools = getMessageTools({
      workspaceId: "ws1",
      userId: "user1",
      userEmail: "u@example.com",
      triggerChannelId: "ch1",
      // no currentTaskId
    });

    await (tools.send_message as any).execute({ message: "hi" });

    expect(getOrCreateChannelConversation).toHaveBeenCalled();
    expect(prisma.conversationHistory.create).not.toHaveBeenCalled();
  });
});
