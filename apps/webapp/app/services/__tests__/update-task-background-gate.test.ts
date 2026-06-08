/**
 * Tests the background/scheduled-run gate inside update_task.
 *
 * On a background execution turn (scheduled task fire, or any background
 * agent run), the agent must not be able to rewrite <plan> or <outcome>
 * on the task description — the plan is frozen until the user is back in
 * the loop. Only <log> writes (append) and clearLog are permitted.
 *
 * Live-chat turns (isBackgroundExecution falsy) are unrestricted.
 *
 * We mock every collaborator that would otherwise touch the DB or page
 * store. The gate is meant to short-circuit before any write call lands,
 * so mocks for those writes double as a regression check: if the gate
 * leaks, the mocks would be called.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const taskServerMocks = vi.hoisted(() => ({
  resolveTaskId: vi.fn(),
  getTaskById: vi.fn(),
  updateTask: vi.fn(),
  updateScheduledTask: vi.fn(),
  changeTaskStatus: vi.fn(),
  createTask: vi.fn(),
  createScheduledTask: vi.fn(),
  deleteTask: vi.fn(),
  rescheduleTaskAt: vi.fn(),
  getScheduledTasksForWorkspace: vi.fn(),
  recalculateTasksForTimezone: vi.fn(),
  getTaskTree: vi.fn(),
  reparentTask: vi.fn(),
  getTasks: vi.fn(),
}));
vi.mock("~/services/task.server", () => taskServerMocks);

const codingTaskMocks = vi.hoisted(() => ({
  upsertPageSection: vi.fn(async () => {}),
  clearPageSection: vi.fn(async () => {}),
}));
vi.mock("~/services/coding-task.server", () => codingTaskMocks);

const contentMocks = vi.hoisted(() => ({
  setPageContentFromHtml: vi.fn(async () => {}),
  getPageContentAsHtml: vi.fn(async () => ""),
}));
vi.mock("~/services/hocuspocus/content.server", () => contentMocks);

vi.mock("~/services/page.server", () => ({
  findOrCreateTaskPage: vi.fn(async () => ({ id: "page-1" })),
  findOrCreateDailyPage: vi.fn(async () => ({ id: "daily-1" })),
}));

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("~/services/conversation.server", () => ({
  createEmptyConversation: vi.fn(),
}));

vi.mock("~/lib/queue-adapter.server", () => ({
  enqueueTask: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  prisma: {},
}));

vi.mock("~/env.server", () => ({
  env: {},
}));

vi.mock("~/services/task.phase", () => ({
  getTaskPhase: vi.fn(() => "execute"),
  setTaskPhaseInMetadata: vi.fn(),
}));

vi.mock("~/utils/schedule-utils", () => ({
  computeNextRun: vi.fn(),
  getRecurrenceIntervalMinutes: vi.fn(() => 60),
  formatScheduleForUser: vi.fn(),
}));

import { getTaskTools } from "~/services/agent/tools/task-tools";

function tools(isBackgroundExecution: boolean) {
  return getTaskTools(
    "ws-1",
    "user-1",
    isBackgroundExecution,
    "UTC",
    "email",
    ["email"],
    60,
    [],
    "tk-current",
    "channel",
  );
}

async function runUpdate(
  isBackgroundExecution: boolean,
  args: Record<string, unknown>,
) {
  const t = tools(isBackgroundExecution);
  const tool = t.update_task as { execute: (a: unknown) => Promise<string> };
  return await tool.execute({ taskId: "tk-test", ...args });
}

beforeEach(() => {
  vi.clearAllMocks();
  taskServerMocks.resolveTaskId.mockResolvedValue("task-uuid-1");
  taskServerMocks.getTaskById.mockResolvedValue({
    id: "task-uuid-1",
    pageId: "page-1",
    schedule: "FREQ=DAILY",
    workspaceId: "ws-1",
    userId: "user-1",
  });
});

describe("update_task — background gate REJECTS <plan> and <outcome>", () => {
  it("rejects <plan> write on background run", async () => {
    const result = await runUpdate(true, {
      description: "<plan>new plan</plan>",
    });

    expect(result).toMatch(/<plan> and <outcome> writes are not allowed/);
    expect(codingTaskMocks.upsertPageSection).not.toHaveBeenCalled();
    expect(contentMocks.setPageContentFromHtml).not.toHaveBeenCalled();
  });

  it("rejects <outcome> write on background run", async () => {
    const result = await runUpdate(true, {
      description: "<outcome>some result</outcome>",
    });

    expect(result).toMatch(/<plan> and <outcome> writes are not allowed/);
    expect(codingTaskMocks.upsertPageSection).not.toHaveBeenCalled();
  });

  it("rejects legacy <output> tag on background run (same alias as <outcome>)", async () => {
    const result = await runUpdate(true, {
      description: "<output>weekly summary</output>",
    });

    expect(result).toMatch(/<plan> and <outcome> writes are not allowed/);
    expect(codingTaskMocks.upsertPageSection).not.toHaveBeenCalled();
  });

  it("rejects mixed <log>+<plan> on background run (plan poisons the whole call)", async () => {
    const result = await runUpdate(true, {
      description: "<log>today</log><plan>rewrite</plan>",
    });

    expect(result).toMatch(/<plan> and <outcome> writes are not allowed/);
    expect(codingTaskMocks.upsertPageSection).not.toHaveBeenCalled();
  });

  it("rejects replaceDescription: true on background run", async () => {
    const result = await runUpdate(true, {
      description: "<log>safe content</log>",
      replaceDescription: true,
    });

    expect(result).toMatch(/replaceDescription is not allowed/);
    expect(contentMocks.setPageContentFromHtml).not.toHaveBeenCalled();
  });
});

describe("update_task — background gate ALLOWS <log> and clearLog", () => {
  it("allows pure <log> write on background run", async () => {
    const result = await runUpdate(true, {
      description: "<log>day 3: 2 new emails</log>",
    });

    expect(result).toMatch(/description updated/);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledWith(
      "page-1",
      "<log>day 3: 2 new emails</log>",
    );
  });

  it("allows clearLog: true on background run", async () => {
    const result = await runUpdate(true, {
      clearLog: true,
    });

    expect(result).toMatch(/log cleared/);
    expect(codingTaskMocks.clearPageSection).toHaveBeenCalledTimes(1);
    expect(codingTaskMocks.clearPageSection).toHaveBeenCalledWith(
      "page-1",
      "log",
    );
  });

  it("allows <log> append AND clearLog in the same call (the weekly send pattern)", async () => {
    const result = await runUpdate(true, {
      description: "<log>final day</log>",
      clearLog: true,
    });

    // Both ops happen, in order — append then wipe is unusual but explicitly
    // permitted. The typical "send and clear" call would be clearLog alone
    // (after using send_message to deliver the body of the existing log).
    expect(result).toMatch(/description updated/);
    expect(result).toMatch(/log cleared/);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
    expect(codingTaskMocks.clearPageSection).toHaveBeenCalledTimes(1);
  });
});

describe("update_task — live-chat (isBackgroundExecution=false) is UNRESTRICTED", () => {
  it("allows <plan> write in live chat", async () => {
    const result = await runUpdate(false, {
      description: "<plan>v2 plan from user request</plan>",
    });

    expect(result).toMatch(/description updated/);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
  });

  it("allows <outcome> write in live chat", async () => {
    const result = await runUpdate(false, {
      description: "<outcome>shipped</outcome>",
    });

    expect(result).toMatch(/description updated/);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
  });

  it("allows <log> write in live chat too", async () => {
    const result = await runUpdate(false, {
      description: "<log>manual entry</log>",
    });

    expect(result).toMatch(/description updated/);
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
  });
});

describe("update_task — scheduling fields bundled with description (the bug path)", () => {
  it("routes description through upsertPageSection, not setPageContentFromHtml (the fix)", async () => {
    // Before the fix, passing any scheduling field alongside description
    // routed into updateScheduledTask, which wholesale-replaced the page
    // via setPageContentFromHtml — obliterating <plan>. The fix splits the
    // two: scheduling fields go to updateScheduledTask, description goes
    // through upsertPageSection (zone-aware merge).
    const result = await runUpdate(false, {
      description: "<log>entry from scheduling-tied update</log>",
      isActive: true,
    });

    expect(result).toMatch(/description updated/);
    expect(taskServerMocks.updateScheduledTask).toHaveBeenCalledTimes(1);
    // Critical: the description must NOT have been passed down into
    // updateScheduledTask (which would wholesale-replace) — it's handled
    // separately by upsertPageSection.
    const callArgs = taskServerMocks.updateScheduledTask.mock.calls[0][2];
    expect(callArgs.description).toBeUndefined();
    expect(codingTaskMocks.upsertPageSection).toHaveBeenCalledTimes(1);
    expect(contentMocks.setPageContentFromHtml).not.toHaveBeenCalled();
  });

  it("background + scheduling field + <plan> in description → still rejected", async () => {
    const result = await runUpdate(true, {
      description: "<plan>sneaking a plan rewrite</plan>",
      isActive: true,
    });

    expect(result).toMatch(/<plan> and <outcome> writes are not allowed/);
    // No writes of any kind should fire.
    expect(taskServerMocks.updateScheduledTask).not.toHaveBeenCalled();
    expect(codingTaskMocks.upsertPageSection).not.toHaveBeenCalled();
    expect(contentMocks.setPageContentFromHtml).not.toHaveBeenCalled();
  });
});
