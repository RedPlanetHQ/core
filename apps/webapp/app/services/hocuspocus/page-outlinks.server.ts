import { prisma } from "~/db.server";
import { updateContentForDocument } from "~/services/hocuspocus/content.server";

interface Outlink {
  type: "Task";
  id: string;
}

/**
 * Traverse TipTap JSON and collect all taskItem nodes that have an id attr.
 */
function collectTaskIds(node: any): string[] {
  const ids: string[] = [];

  if (node.type === "taskItem" && node.attrs?.id) {
    ids.push(node.attrs.id);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      ids.push(...collectTaskIds(child));
    }
  }

  return ids;
}

/**
 * Parse the page's stored JSON, extract all taskItem ids,
 * and persist them to Page.outlinks.
 * Called from the Hocuspocus store hook on every save.
 */
export async function storeOutlinks(
  pageId: string,
  json: unknown,
): Promise<void> {
  try {
    const taskIds = [...new Set(collectTaskIds(json as any))];
    const newOutlinks: Outlink[] = taskIds.map((id) => ({ type: "Task", id }));

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { outlinks: true },
    });

    const currentIds = ((page?.outlinks ?? []) as Outlink[])
      .map((o) => o.id)
      .sort();
    const newIds = taskIds.slice().sort();
    const unchanged =
      currentIds.length === newIds.length &&
      currentIds.every((id, i) => id === newIds[i]);

    if (!unchanged) {
      await prisma.page.update({
        where: { id: pageId },
        data: { outlinks: newOutlinks as any },
      });
    }
  } catch (err) {
    console.error("[storeOutlinks] failed for page", pageId, err);
  }
}

/**
 * Recursively update all taskItem nodes matching taskId with newTitle.
 * Returns true if any node was updated.
 */
function updateTaskTitleInDoc(node: any, taskId: string, newTitle: string): boolean {
  let updated = false;

  if (node.type === "taskItem" && node.attrs?.id === taskId) {
    const paragraph = node.content?.[0];
    if (paragraph?.type === "paragraph") {
      const currentText = paragraph.content?.[0]?.text ?? "";
      // Only update if text actually differs — prevents write loops
      if (currentText !== newTitle) {
        paragraph.content = newTitle ? [{ type: "text", text: newTitle }] : [];
        updated = true;
      }
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (updateTaskTitleInDoc(child, taskId, newTitle)) updated = true;
    }
  }

  return updated;
}

/**
 * When a task's title changes, find all pages that reference it via outlinks
 * and update the taskItem text in each page's stored JSON.
 * Persists via Hocuspocus so live clients get the update in real-time.
 */
export async function updateTaskTitleInPages(
  taskId: string,
  newTitle: string,
): Promise<void> {
  try {
    const pages = await prisma.page.findMany({
      where: {
        outlinks: {
          array_contains: [{ type: "Task", id: taskId }] as any,
        },
      },
      select: { id: true, description: true },
    });

    for (const page of pages) {
      if (!page.description) continue;

      let doc: any;
      try {
        doc = JSON.parse(page.description);
      } catch {
        continue;
      }

      const updated = updateTaskTitleInDoc(doc, taskId, newTitle);
      if (updated) {
        await updateContentForDocument(page.id, doc);
      }
    }
  } catch (err) {
    console.error("[updateTaskTitleInPages] failed for task", taskId, err);
  }
}
