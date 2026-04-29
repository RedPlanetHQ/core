/**
 * Integration tests for the butler two-phase task lifecycle.
 *
 * Runs against the local Postgres DB. We mock only the queue adapter so we
 * can assert which queue call was made (enqueueTask vs enqueueScheduledTask)
 * without running real jobs.
 *
 * Each test creates a throwaway workspace and user, exercises task.server.ts
 * against the real DB, and cleans up at the end.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

// Hoist queue-adapter mocks before the import of task.server.
const queueMocks = vi.hoisted(() => ({
  enqueueTask: vi.fn(),
  enqueueScheduledTask: vi.fn(),
  cancelTaskJob: vi.fn(),
  removeScheduledTask: vi.fn(),
}));

vi.mock("~/lib/queue-adapter.server", () => queueMocks);

const enqueueTaskMock = queueMocks.enqueueTask;
const enqueueScheduledTaskMock = queueMocks.enqueueScheduledTask;
const cancelTaskJobMock = queueMocks.cancelTaskJob;
const removeScheduledTaskMock = queueMocks.removeScheduledTask;

// Silence the logger during tests.
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock the CASE pipeline: the wake-up handler's "execute" branch invokes it,
// but the pipeline itself needs a real LLM and integrations that we don't
// want to touch from tests. We assert it was called; we don't assert what
// it did.
const runCASEPipelineMock = vi.hoisted(() => vi.fn());
vi.mock("~/services/agent/decision-agent-pipeline", () => ({
  runCASEPipeline: runCASEPipelineMock,
}));

// Skip the real token/client/HTTP setup — those are tangential to branch
// selection.
vi.mock("~/services/personalAccessToken.server", () => ({
  getOrCreatePersonalAccessToken: vi.fn(async () => ({ token: "test-token" })),
}));
vi.mock("@redplanethq/sdk", () => ({
  CoreClient: vi.fn(() => ({})),
}));
vi.mock("~/services/agent/orchestrator-tools.http", () => ({
  HttpOrchestratorTools: vi.fn(() => ({})),
}));
vi.mock("~/services/agent/context/decision-context", () => ({
  createTaskTriggerFromDb: vi.fn(() => ({})),
  buildScheduledTaskContext: vi.fn(async () => ({})),
}));
vi.mock("~/models/workspace.server", () => ({
  getWorkspacePersona: vi.fn(async () => ({ content: "" })),
}));
vi.mock("~/services/hocuspocus/content.server", () => ({
  getPageContentAsHtml: vi.fn(async () => ""),
  setPageContentFromHtml: vi.fn(),
}));
vi.mock("~/services/hocuspocus/page-outlinks.server", () => ({
  updateTaskTitleInPages: vi.fn(),
}));
vi.mock("~/services/page.server", () => ({
  findOrCreateTaskPage: vi.fn(async (_ws, _u, taskId) => ({
    id: `page-for-${taskId}`,
  })),
}));

const creditMocks = vi.hoisted(() => ({
  hasCredits: vi.fn(async () => true),
  deductCredits: vi.fn(async () => undefined),
}));
vi.mock("~/trigger/utils/utils", () => creditMocks);
const hasCreditsMock = creditMocks.hasCredits;

vi.mock("~/services/byok.server", () => ({
  isWorkspaceBYOK: vi.fn(async () => false),
}));

import { prisma } from "~/db.server";
import {
  createTask,
  changeTaskStatus,
  createScheduledTask,
  updateScheduledTask,
} from "~/services/task.server";
import { processScheduledTask } from "~/jobs/task/scheduled-task.logic";

// Use a stable, unique prefix so repeat runs don't collide and we can scope
// cleanup tightly.
const RUN_TAG = `tl-${Date.now()}`;
const TEST_WORKSPACE_ID = `ws-${RUN_TAG}`;
const TEST_USER_ID = `u-${RUN_TAG}`;

async function ensureFixture() {
  // Create a throwaway user and workspace. UserWorkspace link not required
  // for createTask to work (it only needs workspaceId and userId as strings).
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: `${RUN_TAG}@test.local`,
      authenticationMethod: "MAGIC_LINK",
    },
  });
  await prisma.workspace.upsert({
    where: { id: TEST_WORKSPACE_ID },
    update: {},
    create: {
      id: TEST_WORKSPACE_ID,
      name: `test-${RUN_TAG}`,
      slug: `test-${RUN_TAG}`,
    },
  });
}

async function cleanTasks() {
  await prisma.task.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
  // Also clean pages we created via task flow
  await prisma.page.deleteMany({
    where: { workspaceId: TEST_WORKSPACE_ID },
  });
}

beforeEach(async () => {
  enqueueTaskMock.mockClear();
  enqueueScheduledTaskMock.mockClear();
  cancelTaskJobMock.mockClear();
  removeScheduledTaskMock.mockClear();
  runCASEPipelineMock.mockClear();
  runCASEPipelineMock.mockResolvedValue({
    success: true,
    shouldMessage: false,
    conversationId: "conv-test",
  });
  hasCreditsMock.mockClear();
  hasCreditsMock.mockResolvedValue(true);
  await ensureFixture();
  await cleanTasks();
});

afterAll(async () => {
  await cleanTasks();
  await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.$disconnect();
});

// ─── createTask — buffer wake-up ─────────────────────────────────────

describe("createTask — buffer wake-up", () => {
  it("creates task in Todo + phase=prep and schedules a 2-minute wake-up", async () => {
    const before = Date.now();
    const task = await createTask(
      TEST_WORKSPACE_ID,
      TEST_USER_ID,
      "Test task",
    );
    const after = Date.now();

    // Status + phase
    expect(task.status).toBe("Todo");
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    expect(meta.phase).toBe("prep");

    // nextRunAt should be ~2 minutes from now
    expect(task.nextRunAt).toBeTruthy();
    const nextRunMs = task.nextRunAt!.getTime();
    expect(nextRunMs).toBeGreaterThanOrEqual(before + 2 * 60 * 1000 - 1000);
    expect(nextRunMs).toBeLessThanOrEqual(after + 2 * 60 * 1000 + 1000);

    // Immediate enqueue is GONE, scheduled wake-up is used instead
    expect(enqueueTaskMock).not.toHaveBeenCalled();
    expect(enqueueScheduledTaskMock).toHaveBeenCalledTimes(1);
    const [payload, scheduledAt] = enqueueScheduledTaskMock.mock.calls[0];
    expect(payload.taskId).toBe(task.id);
    expect(scheduledAt.getTime()).toBe(nextRunMs);
  });

  it("skips buffer when task is created with status != Todo (reserved for recurring)", async () => {
    const task = await createTask(
      TEST_WORKSPACE_ID,
      TEST_USER_ID,
      "Direct task",
      undefined,
      { status: "Ready" },
    );
    // status forwarding path — no buffer
    expect(task.status).toBe("Ready");
    expect(task.nextRunAt).toBeNull();
    expect(enqueueScheduledTaskMock).not.toHaveBeenCalled();
  });
});

// ─── processScheduledTask — wake-up branching ────────────────────────

describe("processScheduledTask — wake-up branching", () => {
  it("buffer expiry (Todo + prep, no schedule) → enqueueTask for prep", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Prep me",
        status: "Todo",
        metadata: { phase: "prep" },
        nextRunAt: new Date(Date.now() - 1000), // fire time reached
        isActive: true,
      },
    });

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(enqueueTaskMock).toHaveBeenCalledWith({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
    });
    expect(runCASEPipelineMock).not.toHaveBeenCalled();

    const reloaded = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(reloaded.nextRunAt).toBeNull();
    expect(reloaded.status).toBe("Todo"); // prep starts in Todo, no status change yet
  });

  it("normal fire (Ready) → execute via CASE pipeline", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Execute me",
        status: "Ready",
        metadata: { phase: "execute" },
        nextRunAt: new Date(Date.now() - 1000),
        isActive: true,
      },
    });

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(runCASEPipelineMock).toHaveBeenCalledTimes(1);
    expect(enqueueTaskMock).not.toHaveBeenCalled();
  });

  it("fire-override (Todo + prep + schedule) → execute, status flips to Working", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Scheduled fire during prep",
        status: "Todo",
        metadata: { phase: "prep" },
        nextRunAt: new Date(Date.now() - 1000),
        schedule: "FREQ=DAILY;BYHOUR=9",
        isActive: true,
      },
    });

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(runCASEPipelineMock).toHaveBeenCalledTimes(1);
    expect(enqueueTaskMock).not.toHaveBeenCalled();

    const reloaded = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(reloaded.status).toBe("Working");
    const reloadedMeta = (reloaded.metadata ?? {}) as Record<string, unknown>;
    expect(reloadedMeta.phase).toBe("execute");
  });

  it("no-ops when task is deactivated", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Paused",
        status: "Todo",
        metadata: { phase: "prep" },
        nextRunAt: new Date(Date.now() - 1000),
        isActive: false,
      },
    });

    const result = await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(result.success).toBe(true);
    expect(runCASEPipelineMock).not.toHaveBeenCalled();
    expect(enqueueTaskMock).not.toHaveBeenCalled();
  });

  it("no-ops when nextRunAt in DB has moved later (stale wake-up)", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Rescheduled",
        status: "Ready",
        metadata: { phase: "execute" },
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour out
        isActive: true,
      },
    });

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(runCASEPipelineMock).not.toHaveBeenCalled();
    expect(enqueueTaskMock).not.toHaveBeenCalled();
  });

  it("recurring task: pipeline returns failure → still schedules next occurrence", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Recurring brief",
        status: "Ready",
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() - 1000),
        isActive: true,
      },
    });

    runCASEPipelineMock.mockResolvedValueOnce({
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: "out of credits",
    });

    enqueueScheduledTaskMock.mockClear();

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(runCASEPipelineMock).toHaveBeenCalledTimes(1);
    // Bug A: pipeline failure must NOT skip rescheduling for recurring tasks
    expect(enqueueScheduledTaskMock).toHaveBeenCalledTimes(1);
    const [payload] = enqueueScheduledTaskMock.mock.calls[0];
    expect(payload.taskId).toBe(task.id);

    const reloaded = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(reloaded.isActive).toBe(true);
    expect(reloaded.nextRunAt).toBeTruthy();
    expect(reloaded.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("recurring task: pipeline throws → still schedules next occurrence", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Recurring brief",
        status: "Ready",
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() - 1000),
        isActive: true,
      },
    });

    runCASEPipelineMock.mockRejectedValueOnce(new Error("model timeout"));

    enqueueScheduledTaskMock.mockClear();

    const result = await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(result.success).toBe(false);
    // Bug A: thrown pipeline must NOT skip rescheduling for recurring tasks
    expect(enqueueScheduledTaskMock).toHaveBeenCalledTimes(1);

    const reloaded = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(reloaded.isActive).toBe(true);
    expect(reloaded.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("Working + execute (previous occurrence crashed) → recovery, runs pipeline", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Stuck working",
        status: "Working",
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() - 1000),
        isActive: true,
      },
    });

    const result = await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    expect(result.success).toBe(true);
    // Recovery branch: pipeline must run, not no-op
    expect(runCASEPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("recurring task: out of credits → skips pipeline, schedules next occurrence", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Recurring brief",
        status: "Ready",
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() - 1000),
        isActive: true,
      },
    });

    hasCreditsMock.mockResolvedValueOnce(false);
    enqueueScheduledTaskMock.mockClear();

    const result = await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    // Pipeline must be skipped — we don't burn an LLM call when we know we
    // can't pay for it.
    expect(runCASEPipelineMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe("insufficient_credits");

    // But the recurrence stays alive: next occurrence is queued.
    expect(enqueueScheduledTaskMock).toHaveBeenCalledTimes(1);

    const reloaded = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(reloaded.isActive).toBe(true);
    expect(reloaded.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("one-time scheduled task: pipeline failure → does NOT reschedule (no schedule field)", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "One-time",
        status: "Ready",
        metadata: { phase: "execute" },
        schedule: null, // one-time tasks have no RRule
        nextRunAt: new Date(Date.now() - 1000),
        maxOccurrences: 1,
        isActive: true,
      },
    });

    runCASEPipelineMock.mockResolvedValueOnce({
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: "out of credits",
    });

    enqueueScheduledTaskMock.mockClear();

    await processScheduledTask({
      taskId: task.id,
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
    });

    // No schedule means scheduleNextTaskOccurrence short-circuits; no enqueue
    expect(enqueueScheduledTaskMock).not.toHaveBeenCalled();
  });
});

// ─── changeTaskStatus — butler restrictions ─────────────────────────

describe("changeTaskStatus — butler restrictions", () => {
  it("rejects butler attempting to set Done", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Don't Done me",
        status: "Review",
        metadata: { phase: "execute" },
        isActive: true,
      },
    });

    await expect(
      changeTaskStatus(
        task.id,
        "Done",
        TEST_WORKSPACE_ID,
        TEST_USER_ID,
        "agent",
      ),
    ).rejects.toThrow(/Invalid transition/);
  });

  it("rejects butler attempting to jump Todo → Working (cross-phase)", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "No skipping",
        status: "Todo",
        metadata: { phase: "prep" },
        isActive: true,
      },
    });

    await expect(
      changeTaskStatus(
        task.id,
        "Working",
        TEST_WORKSPACE_ID,
        TEST_USER_ID,
        "agent",
      ),
    ).rejects.toThrow(/Invalid transition/);
  });

  it("allows butler Todo → Ready and flips phase to execute", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Butler approved",
        status: "Todo",
        metadata: { phase: "prep" },
        isActive: true,
      },
    });

    const updated = await changeTaskStatus(
      task.id,
      "Ready",
      TEST_WORKSPACE_ID,
      TEST_USER_ID,
      "agent",
    );
    // changeTaskStatus also enqueues the task when moving to Ready; that's
    // expected behavior and we just assert the DB end-state here.
    const meta = (updated.metadata ?? {}) as Record<string, unknown>;
    expect(meta.phase).toBe("execute");
    // Status may be Ready (no subtasks) or Working (if auto-enqueued and
    // flipped by subtask-first path). For a childless task it's Ready.
    expect(["Ready", "Working"]).toContain(updated.status);
  });

  it("allows user Review → Done", async () => {
    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "User completing",
        status: "Review",
        metadata: { phase: "execute" },
        isActive: true,
      },
    });

    const updated = await changeTaskStatus(
      task.id,
      "Done",
      TEST_WORKSPACE_ID,
      TEST_USER_ID,
      "user",
    );
    expect(updated.status).toBe("Done");
  });
});

// ─── createScheduledTask — recurring skips prep ─────────────────────

describe("createScheduledTask — recurring / scheduled", () => {
  it("creates a recurring task in Ready + phase=execute (no prep)", async () => {
    // Need a UserWorkspace link for createScheduledTask to find timezone.
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await createScheduledTask(TEST_WORKSPACE_ID, TEST_USER_ID, {
      title: "Morning brief",
      schedule: "FREQ=DAILY;BYHOUR=9",
    });

    expect(task.status).toBe("Ready");
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    expect(meta.phase).toBe("execute");
    expect(enqueueScheduledTaskMock).toHaveBeenCalled();
  });

  it("updateScheduledTask with title only does NOT touch the queue", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Recurring brief",
        status: "Working", // mid-fire
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
        isActive: true,
      },
    });

    removeScheduledTaskMock.mockClear();
    enqueueScheduledTaskMock.mockClear();

    await updateScheduledTask(task.id, TEST_WORKSPACE_ID, {
      title: "Renamed",
    });

    // Title-only update must not cancel and re-enqueue the in-flight wake-up.
    expect(removeScheduledTaskMock).not.toHaveBeenCalled();
    expect(enqueueScheduledTaskMock).not.toHaveBeenCalled();
  });

  it("updateScheduledTask with new schedule DOES re-enqueue with new time", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: TEST_WORKSPACE_ID,
        userId: TEST_USER_ID,
        title: "Recurring brief",
        status: "Ready",
        metadata: { phase: "execute" },
        schedule: "FREQ=DAILY;BYHOUR=9",
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
        isActive: true,
      },
    });

    removeScheduledTaskMock.mockClear();
    enqueueScheduledTaskMock.mockClear();

    await updateScheduledTask(task.id, TEST_WORKSPACE_ID, {
      schedule: "FREQ=DAILY;BYHOUR=15",
    });

    expect(removeScheduledTaskMock).toHaveBeenCalledTimes(1);
    expect(enqueueScheduledTaskMock).toHaveBeenCalledTimes(1);
  });

  it("creates a one-time scheduled task in Ready + phase=execute (no prep)", async () => {
    await prisma.userWorkspace.upsert({
      where: {
        userId_workspaceId: {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
        },
      },
      update: {},
      create: {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
      },
    });

    const task = await createScheduledTask(TEST_WORKSPACE_ID, TEST_USER_ID, {
      title: "Email vendor",
      schedule: "FREQ=DAILY;BYHOUR=15",
      maxOccurrences: 1,
    });

    expect(task.status).toBe("Ready");
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    expect(meta.phase).toBe("execute");
  });
});
