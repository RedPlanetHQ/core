import { prisma } from "~/db.server";
import type { Task, TaskStatus } from "@prisma/client";

export async function createTask(
  workspaceId: string,
  userId: string,
  title: string,
  description?: string,
): Promise<Task> {
  return prisma.task.create({
    data: {
      title,
      description,
      status: "Backlog",
      workspaceId,
      userId,
    },
  });
}

export async function getTaskById(id: string): Promise<Task | null> {
  return prisma.task.findUnique({ where: { id } });
}

export async function getTasks(
  workspaceId: string,
  status?: TaskStatus,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: { workspaceId, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
  });
}

export async function searchTasks(
  workspaceId: string,
  search: string,
  limit = 10,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      workspaceId,
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { status } });
}

export async function updateTaskConversationIds(
  id: string,
  conversationIds: string[],
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { conversationIds } });
}

export async function markTaskInProcess(id: string, jobId?: string): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { status: "InProcess", ...(jobId && { jobId }) },
  });
}

export async function markTaskCompleted(id: string, result: string): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { status: "Completed", result },
  });
}

export async function markTaskFailed(id: string, error: string): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { status: "Backlog", error },
  });
}

export async function deleteTask(id: string, workspaceId: string): Promise<Task> {
  const task = await prisma.task.findFirst({ where: { id, workspaceId } });
  if (!task) throw new Error(`Task ${id} not found`);
  return prisma.task.delete({ where: { id } });
}
