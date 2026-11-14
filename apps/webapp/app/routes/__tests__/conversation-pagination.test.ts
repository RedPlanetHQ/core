import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetConversationsListSchema } from "~/services/conversation-query";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), list: vi.fn() }));
vi.mock("~/services/apiAuth.server", () => ({
  authenticateApiRequestWithFailure: mocks.authenticate,
}));
vi.mock("~/services/session.server", () => ({ getUserSession: vi.fn() }));
vi.mock("~/services/logger.service", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/utils/apiCors", () => ({
  apiCors: async (_req: Request, res: Response) => res,
}));
vi.mock("~/services/conversation.server", async () => ({
  GetConversationsListSchema: (await import("~/services/conversation-query"))
    .GetConversationsListSchema,
  getConversationsList: mocks.list,
}));
import { loader } from "../api.v1.conversations";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    type: "PRIVATE",
    workspaceId: "ws-1",
    userId: "user-1",
  });
  mocks.list.mockResolvedValue({
    conversations: [],
    pagination: { page: 1, limit: 20, total: 0 },
  });
});
function load(query = "") {
  return loader({
    request: new Request(`http://localhost/api/v1/conversations${query}`),
    params: {},
    context: {},
  });
}

describe("conversation pagination through the exported loader", () => {
  it.each([
    "?page=abc",
    "?page=0",
    "?page=-1",
    "?page=1.5",
    "?page=2tail",
    "?page=",
    "?limit=abc",
    "?limit=0",
    "?limit=-1",
    "?limit=101",
    "?limit=1.5",
    "?limit=1e2",
    "?limit=",
    "?page=9007199254740992",
    "?page=9007199254740991&limit=100",
  ])("rejects %s before querying conversations", async (query) => {
    expect((await load(query)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("retains default pagination", async () => {
    expect((await load()).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("ws-1", "user-1", {
      page: "1",
      limit: "20",
    });
  });
  it("accepts valid boundary values and preserves filters", async () => {
    expect(
      (await load("?page=2&limit=100&source=slack&search=hello")).status,
    ).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("ws-1", "user-1", {
      page: "2",
      limit: "100",
      source: "slack",
      search: "hello",
    });
  });
  it("keeps string DTOs compatible with existing parseInt callers", () => {
    expect(
      GetConversationsListSchema.parse({ page: "01", limit: "1" }),
    ).toEqual({ page: "01", limit: "1" });
  });
});
