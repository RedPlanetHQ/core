import { beforeEach, expect, it, vi } from "vitest";
import { loader } from "../api.v1.activities";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), find: vi.fn() }));
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
vi.mock("~/db.server", () => ({
  prisma: {
    integrationAccount: { findMany: async () => [] },
    activity: { findMany: mocks.find },
  },
}));

const createdAt = new Date("2026-01-15T10:00:00.000Z");

function load(cursor?: string) {
  const query = new URLSearchParams({ limit: "1", source: "gmail" });
  if (cursor !== undefined) query.set("cursor", cursor);
  return loader({
    request: new Request(`http://localhost/api/v1/activities?${query}`),
    params: {},
    context: {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    type: "PRIVATE",
    workspaceId: "workspace",
    userId: "user",
  });
  mocks.find.mockResolvedValue([]);
});

it("uses an activity ID to break ties without dropping source filters", async () => {
  mocks.find
    .mockResolvedValueOnce([{ id: "act-b", createdAt }])
    .mockResolvedValueOnce([{ id: "act-a", createdAt }]);
  const first = await load();
  const page = await first.json();
  expect(page).toMatchObject({ activities: [{ id: "act-b" }], hasMore: true });
  expect(page.nextCursor).toContain("act-b");

  const second = await load(page.nextCursor);
  expect(await second.json()).toMatchObject({
    activities: [{ id: "act-a" }],
  });
  expect(mocks.find).toHaveBeenLastCalledWith(
    expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: {
        workspaceId: "workspace",
        deleted: null,
        integrationAccount: { integrationDefinition: { slug: "gmail" } },
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, id: { lt: "act-b" } },
        ],
      },
    }),
  );
});

it("accepts legacy timestamps and rejects an invalid cursor", async () => {
  expect((await load(createdAt.toISOString())).status).toBe(200);
  expect(mocks.find).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ createdAt: { lt: createdAt } }),
    }),
  );

  expect((await load("bad-cursor")).status).toBe(400);
  expect(mocks.find).toHaveBeenCalledOnce();
});
