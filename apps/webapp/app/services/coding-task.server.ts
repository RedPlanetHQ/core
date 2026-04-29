import {
  getPageContentAsHtml,
  setPageContentFromHtml,
  htmlToTiptapJson,
  tiptapJsonToHtml,
} from "~/services/hocuspocus/content.server";
import { prisma } from "~/db.server";
import { changeTaskStatus } from "~/services/task.server";
import { getTaskPhase } from "~/services/task.phase";
import { logger } from "~/services/logger.service";

const STRUCTURED_TYPES = new Set(["plan", "output"]);

type DocNode = { type: string; content?: DocNode[]; [key: string]: unknown };

/**
 * Merge structured agent sections (`plan`, `output`) from `input` into `existing`.
 *
 * Strict input contract: at most one top-level <plan> and at most one
 * top-level <output> per call. Multiple of either throws — the agent sees
 * the error and self-corrects.
 *
 * For each (≤1) plan/output node in the input: replace the FIRST matching
 * node in `existing` in place (position preserved); append at end if no
 * match exists. Everything else in `input` is dropped — the user's prose
 * is never modified. Pre-existing duplicates in `existing` are NOT deduped.
 *
 * Returns a new document; inputs are not mutated.
 */
export function mergeStructuredSections(
  existing: { type: string; content?: DocNode[] },
  input: { type: string; content?: DocNode[] },
): { type: string; content: DocNode[] } {
  const inputCounts = new Map<string, number>();
  for (const node of input.content ?? []) {
    if (STRUCTURED_TYPES.has(node.type)) {
      inputCounts.set(node.type, (inputCounts.get(node.type) ?? 0) + 1);
    }
  }
  for (const [type, count] of inputCounts.entries()) {
    if (count > 1) {
      throw new Error(
        `Description input contains ${count} <${type}> nodes; at most one <${type}> is allowed per call. Combine into a single <${type}>...</${type}> block.`,
      );
    }
  }

  const inputStructured = new Map<string, DocNode>();
  for (const node of input.content ?? []) {
    if (STRUCTURED_TYPES.has(node.type)) {
      inputStructured.set(node.type, structuredClone(node) as DocNode);
    }
  }

  const merged: DocNode[] = [];
  const usedTypes = new Set<string>();
  for (const node of existing.content ?? []) {
    const cloned = structuredClone(node) as DocNode;
    if (
      STRUCTURED_TYPES.has(cloned.type) &&
      inputStructured.has(cloned.type) &&
      !usedTypes.has(cloned.type)
    ) {
      const replacement = inputStructured.get(cloned.type)!;
      merged.push({ ...cloned, content: replacement.content ?? [] });
      usedTypes.add(cloned.type);
    } else {
      merged.push(cloned);
    }
  }
  for (const [type, node] of inputStructured.entries()) {
    if (!usedTypes.has(type)) {
      merged.push(node);
    }
  }

  return { type: existing.type ?? "doc", content: merged };
}

// ─── upsertPageSection ───────────────────────────────────────────────
// Node-type-aware merge for task pages. The agent writes <plan>...</plan>
// and <output>...</output> blocks; this function upserts those into the
// page document while leaving the user's prose untouched. Anything else
// in the input HTML is ignored.

export async function upsertPageSection(
  pageId: string,
  inputHtml: string,
): Promise<void> {
  const existingHtml = (await getPageContentAsHtml(pageId)) || "";
  const existingDoc =
    (existingHtml
      ? (htmlToTiptapJson(existingHtml) as {
          type: string;
          content?: DocNode[];
        })
      : null) ?? { type: "doc", content: [] };
  const inputDoc = htmlToTiptapJson(inputHtml) as {
    type: string;
    content?: DocNode[];
  };

  const merged = mergeStructuredSections(existingDoc, inputDoc);
  const mergedHtml = tiptapJsonToHtml(merged);
  await setPageContentFromHtml(pageId, mergedHtml);
}


// ─── Reply Detection ────────────────────────────────────────────────
// When a user replies to a conversation linked to a Waiting task,
// re-enqueue the task so the agent can process the reply.

export async function checkWaitingTaskReply(
  conversationId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  // Find any Waiting tasks that have this conversation linked
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId,
      status: "Waiting",
      conversationIds: { has: conversationId },
    },
  });

  for (const task of tasks) {
    // Phase-aware: prep → back to Todo (continue planning),
    // execute → Ready (auto-enqueues, resumes execution)
    const phase = getTaskPhase(task);
    const targetStatus = phase === "prep" ? "Todo" : "Ready";

    await changeTaskStatus(task.id, targetStatus, workspaceId, userId, "user");

    logger.info(`Waiting task reply detected, moved to ${targetStatus} (phase: ${phase})`, {
      taskId: task.id,
      conversationId,
    });
  }
}
