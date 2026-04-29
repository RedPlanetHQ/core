import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and external deps before importing the module under test
vi.mock("~/db.server", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("~/services/task.server", () => ({
  changeTaskStatus: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/services/hocuspocus/content.server", () => ({
  getPageContentAsHtml: vi.fn(),
  setPageContentFromHtml: vi.fn(),
}));

import {
  checkWaitingTaskReply,
  mergeStructuredSections,
} from "../coding-task.server";
import { prisma } from "~/db.server";
import { changeTaskStatus } from "~/services/task.server";

// ─── Reply Detection ────────────────────────────────────────────────

describe("checkWaitingTaskReply", () => {
  const mockFindMany = prisma.task.findMany as ReturnType<typeof vi.fn>;
  const mockChangeStatus = changeTaskStatus as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves Waiting task to Ready on reply", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "task-1",
        status: "Waiting",
        conversationIds: ["conv-1"],
        metadata: null,
      },
    ]);

    await checkWaitingTaskReply("conv-1", "workspace-1", "user-1");

    expect(mockChangeStatus).toHaveBeenCalledWith(
      "task-1",
      "Ready",
      "workspace-1",
      "user-1",
      "user",
    );
  });

  it("moves task to Ready regardless of task metadata", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "task-2",
        status: "Waiting",
        conversationIds: ["conv-2"],
        metadata: {
          phase: "plan",
          sessionId: "sess-2",
          gatewayId: "gw-1",
        },
      },
    ]);

    await checkWaitingTaskReply("conv-2", "workspace-1", "user-1");

    expect(mockChangeStatus).toHaveBeenCalledWith(
      "task-2",
      "Ready",
      "workspace-1",
      "user-1",
      "user",
    );
  });

  it("does NOT change status when no Waiting tasks match the conversation", async () => {
    mockFindMany.mockResolvedValue([]);

    await checkWaitingTaskReply("conv-3", "workspace-1", "user-1");

    expect(mockChangeStatus).not.toHaveBeenCalled();
  });

  it("moves task to Ready even with null metadata", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "task-3",
        status: "Waiting",
        conversationIds: ["conv-4"],
        metadata: null,
      },
    ]);

    await checkWaitingTaskReply("conv-4", "workspace-1", "user-1");

    expect(mockChangeStatus).toHaveBeenCalledWith(
      "task-3",
      "Ready",
      "workspace-1",
      "user-1",
      "user",
    );
  });

  it("handles multiple Waiting tasks on same conversation", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "task-a",
        status: "Waiting",
        conversationIds: ["conv-5"],
        metadata: null,
      },
      {
        id: "task-b",
        status: "Waiting",
        conversationIds: ["conv-5"],
        metadata: null,
      },
    ]);

    await checkWaitingTaskReply("conv-5", "workspace-1", "user-1");

    expect(mockChangeStatus).toHaveBeenCalledTimes(2);
  });
});

// ─── mergeStructuredSections ────────────────────────────────────────

type Doc = { type: "doc"; content: any[] };

const doc = (...content: any[]): Doc => ({ type: "doc", content });
const para = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const planNode = (...content: any[]) => ({ type: "plan", content });
const outputNode = (...content: any[]) => ({ type: "output", content });

describe("mergeStructuredSections", () => {
  it("appends a plan node into an empty document", () => {
    const existing = doc();
    const input = doc(planNode(para("step 1")));
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(1);
    expect(merged.content[0].type).toBe("plan");
    expect(merged.content[0].content[0].content[0].text).toBe("step 1");
  });

  it("appends a plan after existing user prose", () => {
    const existing = doc(para("user description"));
    const input = doc(planNode(para("step 1")));
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(2);
    expect(merged.content[0].type).toBe("paragraph");
    expect(merged.content[1].type).toBe("plan");
  });

  it("replaces an existing plan in place, preserving prose around it", () => {
    const existing = doc(
      para("user description"),
      planNode(para("old step")),
      para("trailing note"),
    );
    const input = doc(planNode(para("new step")));
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(3);
    expect(merged.content[0].type).toBe("paragraph");
    expect(merged.content[1].type).toBe("plan");
    expect(merged.content[1].content[0].content[0].text).toBe("new step");
    expect(merged.content[2].type).toBe("paragraph");
    expect(merged.content[2].content[0].text).toBe("trailing note");
  });

  it("updates plan but leaves existing output untouched when input has only plan", () => {
    const existing = doc(
      planNode(para("old step")),
      outputNode(para("old output")),
    );
    const input = doc(planNode(para("new step")));
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(2);
    expect(merged.content[0].content[0].content[0].text).toBe("new step");
    expect(merged.content[1].content[0].content[0].text).toBe("old output");
  });

  it("drops stray paragraphs from input — only plan/output are honored", () => {
    const existing = doc(para("user description"));
    const input = doc(
      para("agent stray text"),
      planNode(para("step 1")),
      para("more stray"),
    );
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(2);
    expect(merged.content[0].content[0].text).toBe("user description");
    expect(merged.content[1].type).toBe("plan");
  });

  it("throws when input has multiple plan nodes", () => {
    const existing = doc();
    const input = doc(planNode(para("plan a")), planNode(para("plan b")));
    expect(() => mergeStructuredSections(existing, input)).toThrow(
      /at most one <plan>/i,
    );
  });

  it("throws when input has multiple output nodes", () => {
    const existing = doc();
    const input = doc(outputNode(para("a")), outputNode(para("b")));
    expect(() => mergeStructuredSections(existing, input)).toThrow(
      /at most one <output>/i,
    );
  });

  it("updates the first existing plan when target has duplicates (no dedupe)", () => {
    const existing = doc(
      planNode(para("first plan")),
      para("middle"),
      planNode(para("second plan")),
    );
    const input = doc(planNode(para("new plan")));
    const merged = mergeStructuredSections(existing, input) as any;
    // No dedupe: target duplicates remain. Only the first matching node is updated.
    expect(merged.content).toHaveLength(3);
    expect(merged.content[0].type).toBe("plan");
    expect(merged.content[0].content[0].content[0].text).toBe("new plan");
    expect(merged.content[2].type).toBe("plan");
    expect(merged.content[2].content[0].content[0].text).toBe("second plan");
  });

  it("appends output when input has output but existing has none", () => {
    const existing = doc(para("user prose"), planNode(para("step 1")));
    const input = doc(outputNode(para("the result")));
    const merged = mergeStructuredSections(existing, input) as any;
    expect(merged.content).toHaveLength(3);
    expect(merged.content[2].type).toBe("output");
  });

  it("ignores plan/output nested inside other nodes", () => {
    const existing = doc(para("user prose"));
    const input = doc({
      type: "blockquote",
      content: [planNode(para("nested step"))],
    });
    const merged = mergeStructuredSections(existing, input) as any;
    // Nothing changed: nested plan is not honored, blockquote is dropped
    expect(merged.content).toHaveLength(1);
    expect(merged.content[0].type).toBe("paragraph");
  });

  it("returns a fresh object — does not mutate inputs", () => {
    const existing = doc(para("user prose"));
    const input = doc(planNode(para("step 1")));
    const existingSnapshot = JSON.stringify(existing);
    const inputSnapshot = JSON.stringify(input);
    mergeStructuredSections(existing, input);
    expect(JSON.stringify(existing)).toBe(existingSnapshot);
    expect(JSON.stringify(input)).toBe(inputSnapshot);
  });
});
