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
//
// Legacy parameters (sectionName, append) are accepted for backward
// compatibility with existing callers but are ignored — merge is driven
// entirely by node types parsed from inputHtml.

export async function upsertPageSection(
  pageId: string,
  _sectionName: string,
  inputHtml: string,
  _append: boolean = false,
): Promise<void> {
  const existingHtml = (await getPageContentAsHtml(pageId)) || "";
  const existingDoc =
    (existingHtml ? (htmlToTiptapJson(existingHtml) as any) : null) ?? {
      type: "doc",
      content: [],
    };
  const inputDoc = htmlToTiptapJson(inputHtml) as any;

  const merged = mergeStructuredSections(existingDoc, inputDoc);
  const mergedHtml = tiptapJsonToHtml(merged);
  await setPageContentFromHtml(pageId, mergedHtml);
}

// ─── splitByH2 / HtmlSection ─────────────────────────────────────────
// Retained for `extractDescriptionSection` below, which still needs to
// strip out non-Description H2 sections from legacy task pages.

interface HtmlSection {
  heading: string | null; // null for content before first H2
  html: string;
}

function splitByH2(html: string): HtmlSection[] {
  if (!html.trim()) return [];

  const sections: HtmlSection[] = [];
  // Split on <h2> tags, keeping the delimiter
  const h2Regex = /<h2[^>]*>/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = h2Regex.exec(html)) !== null) {
    if (m.index > lastIndex) {
      parts.push(html.slice(lastIndex, m.index));
    }
    lastIndex = m.index;
  }
  if (lastIndex < html.length) {
    parts.push(html.slice(lastIndex));
  }

  // If nothing was split, return as single section
  if (parts.length === 0) {
    return [{ heading: null, html }];
  }

  for (const part of parts) {
    const headingMatch = part.match(/<h2[^>]*>(.*?)<\/h2>/i);
    sections.push({
      heading: headingMatch ? headingMatch[1].trim() : null,
      html: part,
    });
  }

  return sections;
}

// ─── extractDescriptionSection ───────────────────────────────────────
// Filters page HTML to the Description section only (or content before
// first H2 if no Description heading exists). Prevents sending
// accumulated brainstorm/plan HTML back to the LLM.

export function extractDescriptionSection(html: string): string {
  if (!html.trim()) return "";

  const sections = splitByH2(html);

  // Look for explicit Description section
  const descSection = sections.find(
    (s) => s.heading?.toLowerCase() === "description",
  );
  if (descSection) return descSection.html;

  // Fallback: content before the first H2 (user's original input)
  const preH2 = sections.find((s) => s.heading === null);
  return preH2?.html || "";
}

// ─── markdownToHtml ──────────────────────────────────────────────────
// Minimal markdown-to-HTML for plan/brainstorm content.
// Handles headings, bold, lists, paragraphs.

export function markdownToHtml(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // Sub-headings (### -> h3)
      if (trimmed.startsWith("### ")) return `<h3>${trimmed.slice(4)}</h3>`;
      // Bold
      const withBold = trimmed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      // List items
      if (trimmed.startsWith("- ")) return `<li>${withBold.slice(2)}</li>`;
      // Checkbox items
      if (trimmed.startsWith("- [ ] "))
        return `<li><input type="checkbox" disabled /> ${withBold.slice(6)}</li>`;
      if (trimmed.startsWith("- [x] "))
        return `<li><input type="checkbox" checked disabled /> ${withBold.slice(6)}</li>`;
      // Regular paragraph
      return `<p>${withBold}</p>`;
    })
    .filter(Boolean)
    .join("");
}

// ─── formatBrainstormQA ─────────────────────────────────────────────
// Formats Q&A pairs as HTML for the Brainstorm Log section.

export function formatBrainstormQA(
  questions: string[],
  answers: string[],
  startIndex: number = 1,
): string {
  let html = "";
  for (let i = 0; i < questions.length; i++) {
    const qNum = startIndex + i;
    html += `<p><strong>Q${qNum}:</strong> ${questions[i]}</p>`;
    if (answers[i]) {
      html += `<p><strong>A${qNum}:</strong> ${answers[i]}</p>`;
    }
  }
  return html;
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
