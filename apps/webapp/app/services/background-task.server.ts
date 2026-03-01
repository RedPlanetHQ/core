/**
 * Background Task Service
 *
 * CRUD operations for BackgroundTask records.
 * Works with both Trigger.dev and BullMQ via queue-adapter.
 */

import { prisma } from "~/db.server";
import type { BackgroundTask } from "@prisma/client";
import type { MessageChannel } from "~/services/agent/types";
import { logger } from "~/services/logger.service";

// ============================================================================
// Constants
// ============================================================================

const MAX_ACTIVE_TASKS_PER_WORKSPACE = 5;

// ============================================================================
// Types
// ============================================================================

export interface CreateBackgroundTaskInput {
  intent: string;
  userId: string;
  timeoutMs?: number; // Default: 30 minutes
  callbackChannel: MessageChannel | "web";
  callbackConversationId?: string;
  callbackMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new background task
 */
export async function createBackgroundTask(
  workspaceId: string,
  input: CreateBackgroundTaskInput,
): Promise<BackgroundTask> {
  const {
    intent,
    userId,
    timeoutMs = 1800000, // 30 minutes default
    callbackChannel,
    callbackConversationId,
    callbackMetadata,
    metadata,
  } = input;

  // Check active task limit
  const activeCount = await prisma.backgroundTask.count({
    where: {
      workspaceId,
      status: { in: ["pending", "running"] },
    },
  });

  if (activeCount >= MAX_ACTIVE_TASKS_PER_WORKSPACE) {
    throw new Error(
      `Maximum active background tasks (${MAX_ACTIVE_TASKS_PER_WORKSPACE}) reached. Wait for existing tasks to complete or cancel them.`,
    );
  }

  logger.info(`Creating background task for workspace ${workspaceId}`, {
    intent: intent.substring(0, 100),
    callbackChannel,
  });

  return prisma.backgroundTask.create({
    data: {
      intent,
      status: "pending",
      timeoutMs,
      callbackChannel,
      callbackConversationId,
      callbackMetadata: callbackMetadata ?? {},
      workspaceId,
      userId,
      metadata: metadata ?? {},
    },
  });
}

/**
 * Get a background task by ID
 */
export async function getBackgroundTaskById(
  taskId: string,
): Promise<BackgroundTask | null> {
  return prisma.backgroundTask.findUnique({
    where: { id: taskId },
  });
}

/**
 * Get active background tasks for a user
 */
export async function getActiveBackgroundTasks(
  workspaceId: string,
  userId: string,
): Promise<BackgroundTask[]> {
  return prisma.backgroundTask.findMany({
    where: {
      workspaceId,
      userId,
      status: { in: ["pending", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all background tasks for a workspace (with optional status filter)
 */
export async function getBackgroundTasks(
  workspaceId: string,
  options?: {
    status?: BackgroundTaskStatus[];
    limit?: number;
  },
): Promise<BackgroundTask[]> {
  const { status, limit = 50 } = options ?? {};

  return prisma.backgroundTask.findMany({
    where: {
      workspaceId,
      ...(status && { status: { in: status } }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Update background task status
 */
export async function updateBackgroundTaskStatus(
  taskId: string,
  status: BackgroundTaskStatus,
  data?: {
    result?: string;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
    jobId?: string;
  },
): Promise<BackgroundTask> {
  logger.info(`Updating background task ${taskId} status to ${status}`);

  return prisma.backgroundTask.update({
    where: { id: taskId },
    data: {
      status,
      ...data,
    },
  });
}

/**
 * Mark task as started
 */
export async function markBackgroundTaskStarted(
  taskId: string,
  jobId?: string,
): Promise<BackgroundTask> {
  return updateBackgroundTaskStatus(taskId, "running", {
    startedAt: new Date(),
    jobId,
  });
}

/**
 * Mark task as completed
 */
export async function markBackgroundTaskCompleted(
  taskId: string,
  result: string,
): Promise<BackgroundTask> {
  return updateBackgroundTaskStatus(taskId, "completed", {
    result,
    completedAt: new Date(),
  });
}

/**
 * Mark task as failed
 */
export async function markBackgroundTaskFailed(
  taskId: string,
  error: string,
): Promise<BackgroundTask> {
  return updateBackgroundTaskStatus(taskId, "failed", {
    error,
    completedAt: new Date(),
  });
}

/**
 * Mark task as timed out
 */
export async function markBackgroundTaskTimeout(
  taskId: string,
): Promise<BackgroundTask> {
  return updateBackgroundTaskStatus(taskId, "timeout", {
    error: "Task exceeded timeout limit",
    completedAt: new Date(),
  });
}

/**
 * Cancel a background task
 */
export async function cancelBackgroundTask(
  taskId: string,
  workspaceId: string,
): Promise<BackgroundTask> {
  // Verify the task belongs to the workspace
  const task = await prisma.backgroundTask.findFirst({
    where: { id: taskId, workspaceId },
  });

  if (!task) {
    throw new Error(`Background task ${taskId} not found in workspace`);
  }

  if (task.status === "completed" || task.status === "failed") {
    throw new Error(`Cannot cancel task with status: ${task.status}`);
  }

  logger.info(`Cancelling background task ${taskId}`);

  return prisma.backgroundTask.update({
    where: { id: taskId },
    data: {
      status: "cancelled",
      completedAt: new Date(),
    },
  });
}

/**
 * Update task metadata
 */
export async function updateBackgroundTaskMetadata(
  taskId: string,
  metadata: Record<string, unknown>,
): Promise<BackgroundTask> {
  const task = await prisma.backgroundTask.findUnique({
    where: { id: taskId },
    select: { metadata: true },
  });

  const existingMetadata = (task?.metadata as Record<string, unknown>) ?? {};

  return prisma.backgroundTask.update({
    where: { id: taskId },
    data: {
      metadata: { ...existingMetadata, ...metadata },
    },
  });
}
