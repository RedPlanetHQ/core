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
  mergeSectionIntoHtml,
  extractDescriptionSection,
  formatBrainstormQA,
  checkWaitingTaskReply,
} from "../coding-task.server";
import { prisma } from "~/db.server";
import { changeTaskStatus } from "~/services/task.server";

// ─── mergeSectionIntoHtml / upsertPageSection ───────────────────────

describe("mergeSectionIntoHtml", () => {
  it("creates a new section on empty page", () => {
    const result = mergeSectionIntoHtml("", "Plan", "<p>The plan</p>");
    expect(result).toBe("<h2>Plan</h2><p>The plan</p>");
  });

  it("appends a new section after existing content", () => {
    const existing = "<p>Task description here</p>";
    const result = mergeSectionIntoHtml(
      existing,
      "Brainstorm Log",
      "<p><strong>Q1:</strong> What API?</p>",
    );
    expect(result).toContain("<p>Task description here</p>");
    expect(result).toContain("<h2>Brainstorm Log</h2>");
    expect(result).toContain("<strong>Q1:</strong>");
  });

  it("replaces existing section content", () => {
    const existing =
      "<h2>Description</h2><p>My task</p><h2>Plan</h2><p>Old plan</p>";
    const result = mergeSectionIntoHtml(existing, "Plan", "<p>New plan</p>");
    expect(result).toContain("<h2>Description</h2><p>My task</p>");
    expect(result).toContain("<h2>Plan</h2><p>New plan</p>");
    expect(result).not.toContain("Old plan");
  });

  it("preserves Description when writing Brainstorm Log", () => {
    const existing = "<h2>Description</h2><p>User's original task</p>";
    const result = mergeSectionIntoHtml(
      existing,
      "Brainstorm Log",
      "<p><strong>Q1:</strong> Question</p>",
    );
    expect(result).toContain("<h2>Description</h2><p>User's original task</p>");
    expect(result).toContain("<h2>Brainstorm Log</h2>");
  });

  it("preserves all other sections when replacing one", () => {
    const existing =
      "<h2>Description</h2><p>Desc</p>" +
      "<h2>Brainstorm Log</h2><p>Q&A</p>" +
      "<h2>Plan</h2><p>Old plan</p>";
    const result = mergeSectionIntoHtml(existing, "Plan", "<p>Revised plan</p>");
    expect(result).toContain("<h2>Description</h2><p>Desc</p>");
    expect(result).toContain("<h2>Brainstorm Log</h2><p>Q&A</p>");
    expect(result).toContain("<h2>Plan</h2><p>Revised plan</p>");
  });

  it("handles case-insensitive section matching", () => {
    const existing = "<h2>plan</h2><p>Old</p>";
    const result = mergeSectionIntoHtml(existing, "Plan", "<p>New</p>");
    expect(result).toContain("<h2>Plan</h2><p>New</p>");
    expect(result).not.toContain("Old");
  });

  it("creates first section on page with no H2 headings", () => {
    const existing = "<p>Just a paragraph</p>";
    const result = mergeSectionIntoHtml(
      existing,
      "Brainstorm Log",
      "<p>Questions</p>",
    );
    expect(result).toContain("<p>Just a paragraph</p>");
    expect(result).toContain("<h2>Brainstorm Log</h2><p>Questions</p>");
  });
});

describe("mergeSectionIntoHtml with append mode", () => {
  it("appends content to an existing section when append=true", () => {
    const existing =
      '<h2>Session</h2><p>sessionId: abc</p><h2>Plan</h2><p>plan content</p>';
    const result = mergeSectionIntoHtml(
      existing,
      "Session",
      "<p>polled gateway: still running</p>",
      true,
    );
    expect(result).toContain("<h2>Session</h2>");
    expect(result).toContain("<p>sessionId: abc</p>");
    expect(result).toContain("<p>polled gateway: still running</p>");
    expect(result).toContain("<h2>Plan</h2>");
    expect(result).toContain("<p>plan content</p>");
  });

  it("still replaces when append=false (default)", () => {
    const existing =
      '<h2>Session</h2><p>old content</p><h2>Plan</h2><p>plan</p>';
    const result = mergeSectionIntoHtml(
      existing,
      "Session",
      "<p>new content</p>",
      false,
    );
    expect(result).toContain("<h2>Session</h2><p>new content</p>");
    expect(result).not.toContain("old content");
    expect(result).toContain("<h2>Plan</h2>");
  });

  it("creates new section when append=true but section doesn't exist yet", () => {
    const existing = '<h2>Plan</h2><p>plan content</p>';
    const result = mergeSectionIntoHtml(
      existing,
      "Session",
      "<p>first entry</p>",
      true,
    );
    expect(result).toContain("<h2>Session</h2><p>first entry</p>");
    expect(result).toContain("<h2>Plan</h2>");
  });
});

// ─── extractDescriptionSection ──────────────────────────────────────

describe("extractDescriptionSection", () => {
  it("extracts Description section when present", () => {
    const html =
      "<h2>Description</h2><p>Build auth</p>" +
      "<h2>Brainstorm Log</h2><p>Q&A here</p>" +
      "<h2>Plan</h2><p>The plan</p>";
    const result = extractDescriptionSection(html);
    expect(result).toContain("Description");
    expect(result).toContain("Build auth");
    expect(result).not.toContain("Brainstorm Log");
    expect(result).not.toContain("Plan");
  });

  it("returns content before first H2 when no Description heading", () => {
    const html =
      "<p>Original task text</p>" +
      "<h2>Brainstorm Log</h2><p>Q&A</p>";
    const result = extractDescriptionSection(html);
    expect(result).toContain("Original task text");
    expect(result).not.toContain("Brainstorm Log");
  });

  it("returns empty string for empty HTML", () => {
    expect(extractDescriptionSection("")).toBe("");
    expect(extractDescriptionSection("   ")).toBe("");
  });

  it("returns full content when page has no H2 headings", () => {
    const html = "<p>Simple task</p><p>More details</p>";
    const result = extractDescriptionSection(html);
    expect(result).toContain("Simple task");
    expect(result).toContain("More details");
  });
});

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

// ─── Helper utilities ───────────────────────────────────────────────

describe("formatBrainstormQA", () => {
  it("formats questions and answers with numbering", () => {
    const html = formatBrainstormQA(
      ["What API?", "Support threads?"],
      ["REST", "No"],
    );
    expect(html).toContain("<strong>Q1:</strong> What API?");
    expect(html).toContain("<strong>A1:</strong> REST");
    expect(html).toContain("<strong>Q2:</strong> Support threads?");
    expect(html).toContain("<strong>A2:</strong> No");
  });

  it("handles questions without answers", () => {
    const html = formatBrainstormQA(["Question?"], []);
    expect(html).toContain("<strong>Q1:</strong> Question?");
    expect(html).not.toContain("A1:");
  });

  it("respects startIndex", () => {
    const html = formatBrainstormQA(["Follow-up?"], ["Yes"], 4);
    expect(html).toContain("<strong>Q4:</strong> Follow-up?");
    expect(html).toContain("<strong>A4:</strong> Yes");
  });
});
