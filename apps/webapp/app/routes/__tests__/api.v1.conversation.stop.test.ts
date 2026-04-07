import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
const mockGetConversation = vi.fn();
const mockUpdateConversationStatus = vi.fn();
const mockLogger = { info: vi.fn(), error: vi.fn() };

vi.mock("~/services/conversation.server", () => ({
  getConversation: mockGetConversation,
  updateConversationStatus: mockUpdateConversationStatus,
}));

vi.mock("~/services/logger.service", () => ({
  logger: mockLogger,
}));

vi.mock("~/services/routeBuilders/apiBuilder.server", () => ({
  createHybridActionApiRoute: (
    _opts: any,
    handler: (args: any) => Promise<Response>,
  ) => {
    // Expose the handler so tests can call it directly
    return {
      loader: async () => new Response(null, { status: 405 }),
      action: async (args: any) => handler(args),
      __handler: handler,
    };
  },
}));

describe("POST /api/v1/conversation/:conversationId/stop", () => {
  let handler: (args: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import(
      "../../routes/api.v1.conversation.$conversationId.stop"
    );
    // The action export is what gets called for POST
    handler = (mod.action as any).__handler ?? mod.action;
  });

  it("returns 404 when conversation does not exist", async () => {
    mockGetConversation.mockResolvedValue(null);

    const response = await handler({
      params: { conversationId: "conv-123" },
      authentication: { userId: "user-1" },
    });

    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Conversation not found");
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
  });

  it("marks running conversation as completed", async () => {
    mockGetConversation.mockResolvedValue({
      id: "conv-123",
      status: "running",
    });
    mockUpdateConversationStatus.mockResolvedValue(undefined);

    const response = await handler({
      params: { conversationId: "conv-123" },
      authentication: { userId: "user-1" },
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockUpdateConversationStatus).toHaveBeenCalledWith(
      "conv-123",
      "completed",
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("stopped by user"),
    );
  });

  it("is idempotent — does not update if not running", async () => {
    mockGetConversation.mockResolvedValue({
      id: "conv-123",
      status: "completed",
    });

    const response = await handler({
      params: { conversationId: "conv-123" },
      authentication: { userId: "user-1" },
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
  });

  it("scopes lookup to authenticated user", async () => {
    mockGetConversation.mockResolvedValue(null);

    await handler({
      params: { conversationId: "conv-123" },
      authentication: { userId: "user-other" },
    });

    expect(mockGetConversation).toHaveBeenCalledWith("conv-123", "user-other");
  });
});
