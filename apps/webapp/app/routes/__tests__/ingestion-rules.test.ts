import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("~/services/apiAuth.server", () => ({
  authenticateApiRequestWithFailure: mocks.authenticate,
}));
vi.mock("~/db.server", () => ({
  prisma: { ingestionRule: mocks },
}));
vi.mock("~/services/session.server", () => ({ getUserSession: vi.fn() }));
vi.mock("~/services/logger.service", () => ({
  logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("~/utils/apiCors", () => ({
  apiCors: async (_request: Request, response: Response) => response,
}));

// Keep the real route builders: they enforce methods, parse JSON and apply Zod.
import { action, loader } from "../api.v1.ingestion-rules";
import {
  action as detailAction,
  loader as detailLoader,
} from "../api.v1.ingestion-rules.$id";

const rule = {
  id: "rule-1",
  name: null,
  text: "Keep decisions",
  source: "api",
  isActive: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
};

function args(method: string, body?: unknown, suffix = "") {
  return {
    request: new Request(`http://localhost/api/v1/ingestion-rules${suffix}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }),
    }),
    params: { id: "rule-1" },
    context: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    type: "PRIVATE",
    apiKey: "test",
    userId: "user-1",
    workspaceId: "ws-1",
  });
  mocks.findMany.mockResolvedValue([rule]);
  mocks.findFirst.mockResolvedValue(rule);
  mocks.create.mockResolvedValue(rule);
  mocks.update.mockImplementation(async ({ where }) => {
    if (!where.id) throw new Error("Missing unique ID");
    return rule;
  });
});

describe("ingestion rule exported routes", () => {
  it("lists active-filtered rules in the authenticated workspace", async () => {
    const response = await loader(
      args("GET", undefined, "?source=api&isActive=false"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).rules).toHaveLength(1);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws-1",
          deleted: null,
          source: "api",
          isActive: false,
        },
      }),
    );
  });
  it("loads a single rule with workspace and soft-delete filters", async () => {
    const response = await detailLoader(args("GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).rule.id).toBe("rule-1");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1", workspaceId: "ws-1", deleted: null },
      }),
    );
  });
  it("returns 404 when the rule is missing or belongs to another workspace", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await detailLoader(args("GET"))).status).toBe(404);
  });
  it("preserves the ID and false flag on a complete PUT", async () => {
    const response = await action(
      args("PUT", {
        id: "rule-1",
        text: "Updated",
        source: "api",
        isActive: false,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1", workspaceId: "ws-1" },
        data: { text: "Updated", source: "api", isActive: false },
      }),
    );
  });
  it("requires an ID for PUT before writing anything", async () => {
    expect(
      (await action(args("PUT", { text: "Updated", source: "api" }))).status,
    ).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires text and source for POST", async () => {
    expect(
      (await action(args("POST", { id: "rule-1", name: "No text" }))).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("defaults isActive only on creation, not on a partial update", async () => {
    expect(
      (await action(args("POST", { text: "Keep facts", source: "api" })))
        .status,
    ).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: true,
          workspaceId: "ws-1",
          userId: "user-1",
        }),
      }),
    );
    expect(
      (await action(args("PUT", { id: "rule-1", name: "Renamed" }))).status,
    ).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Renamed" } }),
    );
  });
  it("requires authentication for both GET routes", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      error: "Invalid API Key",
    });
    expect((await loader(args("GET"))).status).toBe(401);
    expect((await detailLoader(args("GET"))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it("rejects requests without workspace context", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true,
      type: "PRIVATE",
      userId: "user-1",
    });
    expect((await loader(args("GET"))).status).toBe(404);
    expect((await detailLoader(args("GET"))).status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it("soft-deletes only the requested rule in the authenticated workspace", async () => {
    expect((await detailAction(args("DELETE"))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1", workspaceId: "ws-1" },
        data: { deleted: expect.any(Date) },
      }),
    );
  });
});
