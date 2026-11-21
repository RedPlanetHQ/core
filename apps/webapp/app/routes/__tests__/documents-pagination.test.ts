import { beforeEach, expect, it, vi } from "vitest";
import { loader } from "../api.v1.documents";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  documents: vi.fn(),
  count: vi.fn(),
}));

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
    document: { findMany: mocks.documents, count: mocks.count },
    $queryRaw: async () => [],
  },
}));

const createdAt = new Date("2026-01-15T10:00:00.000Z");

function load(cursor?: string) {
  const params = new URLSearchParams({ limit: "1" });
  if (cursor !== undefined) params.set("cursor", cursor);
  return loader({
    request: new Request(`http://localhost/api/v1/documents?${params}`),
    params: {},
    context: {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    type: "PRIVATE",
    workspaceId: "ws-1",
    userId: "user-1",
  });
  mocks.documents.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
});

it("continues through documents that share a creation timestamp", async () => {
  mocks.documents
    .mockResolvedValueOnce([{ id: "doc-b", createdAt }])
    .mockResolvedValueOnce([{ id: "doc-a", createdAt }]);
  mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

  const first = await load();
  expect(first.status).toBe(200);
  const firstPage = await first.json();
  expect(firstPage.nextCursor).toContain("doc-b");
  expect(firstPage.hasMore).toBe(true);

  const second = await load(firstPage.nextCursor);
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({
    documents: [{ id: "doc-a" }],
    hasMore: false,
  });
  const where = {
    workspaceId: "ws-1",
    type: { not: "skill" },
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: "doc-b" } }],
  };
  expect(mocks.documents).toHaveBeenLastCalledWith({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
  });
  expect(mocks.count).toHaveBeenLastCalledWith({ where });
});

it("still accepts an older timestamp-only cursor", async () => {
  expect((await load(createdAt.toISOString())).status).toBe(200);
  expect(mocks.documents).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ createdAt: { lt: createdAt } }),
    }),
  );
});

it("rejects an invalid cursor before querying documents", async () => {
  expect((await load("bad-date|doc-b")).status).toBe(400);
  expect(mocks.documents).not.toHaveBeenCalled();
});
