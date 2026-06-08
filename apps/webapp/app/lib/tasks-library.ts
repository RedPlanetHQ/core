/**
 * Tasks library loader. Reads `docs/tasks.json` straight from the
 * RedPlanetHQ/core repo and surfaces each entry to the UI. Tasks are
 * intentionally thin — title + description + optional schedule + category.
 * The prose lives in the description; longer policy text belongs in a skill
 * the task implicitly applies, not the task itself.
 */

import {z} from "zod";

const LibraryTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  // RRule string in the user's local timezone, or absent for one-shot tasks.
  schedule: z.string().min(1).optional(),
  category: z.string().min(1),
});

const TasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.record(z.string(), LibraryTaskSchema),
});

export type LibraryTaskFields = z.infer<typeof LibraryTaskSchema>;

export interface LibraryTask extends LibraryTaskFields {
  slug: string;
}

const TASKS_JSON_URL =
  "https://raw.githubusercontent.com/RedPlanetHQ/core/main/docs/tasks.json";

let cachedTasks: LibraryTask[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getLibraryTasks(): Promise<LibraryTask[]> {
  if (cachedTasks && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedTasks;
  }

  try {
    const res = await fetch(TASKS_JSON_URL);
    if (!res.ok) return cachedTasks ?? [];

    const raw = await res.json();
    const parsed = TasksFileSchema.safeParse(raw);
    if (!parsed.success) return cachedTasks ?? [];

    const tasks: LibraryTask[] = Object.entries(parsed.data.tasks).map(
      ([slug, fields]) => ({slug, ...fields}),
    );

    cachedTasks = tasks;
    cacheTime = Date.now();
    return tasks;
  } catch {
    return cachedTasks ?? [];
  }
}

export function groupTasksByCategory(
  tasks: LibraryTask[],
): Record<string, LibraryTask[]> {
  return tasks.reduce(
    (acc, task) => {
      if (!acc[task.category]) acc[task.category] = [];
      acc[task.category].push(task);
      return acc;
    },
    {} as Record<string, LibraryTask[]>,
  );
}
