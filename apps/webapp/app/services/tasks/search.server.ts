import Fuse from "fuse.js";
import type { Task } from "@prisma/client";
import { prisma } from "~/db.server";

/**
 * Task search.
 *
 * Current strategy: load workspace tasks and rank in-memory with Fuse.js.
 * Tolerates typos, reordering, and partial words; ranks by closeness.
 *
 * When workspaces grow large enough that loading every task per query
 * is wasteful, swap this implementation for a Postgres `pg_trgm` query
 * (CREATE EXTENSION pg_trgm; GIN index on lower(title)||lower(description)
 * with gin_trgm_ops; ORDER BY similarity DESC). The signature below is
 * the contract — keep it stable so callers don't change.
 */
export async function searchTasks(
  workspaceId: string,
  search: string,
  limit = 10,
): Promise<Task[]> {
  const phrase = search.trim();
  if (!phrase) {
    return prisma.task.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  const tasks = await prisma.task.findMany({ where: { workspaceId } });
  if (tasks.length === 0) return [];

  const fuse = new Fuse(tasks, {
    keys: [
      { name: "title", weight: 0.7 },
      { name: "description", weight: 0.3 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });

  return fuse.search(phrase, { limit }).map((r) => r.item);
}
