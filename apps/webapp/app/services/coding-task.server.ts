import {
  getPageContentAsHtml,
  setPageContentFromHtml,
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
 * Top-level walk only. For each `plan` or `output` node found at the top of
 * `input.content`, locate an existing top-level node of the same type in
 * `existing.content`. If found, replace its content with the input's content.
 * If not found, append the input node to the end of the existing content.
 * Everything else in `input` is dropped — the user's prose in `existing`
 * is never modified by this path.
 *
 * Also dedupes pre-existing duplicate `plan` / `output` nodes in the target,
 * keeping the first occurrence (so collab races or legacy data self-heal on
 * the next agent write).
 *
 * Returns a new document; inputs are not mutated.
 */
export function mergeStructuredSections(
  existing: { type: string; content?: DocNode[] },
  input: { type: string; content?: DocNode[] },
): { type: string; content: DocNode[] } {
  const existingChildren = (existing.content ?? []).map((n) =>
    structuredClone(n) as DocNode,
  );

  // Step 1: dedupe pre-existing structured nodes (keep first of each type).
  const seen = new Set<string>();
  const deduped: DocNode[] = [];
  for (const node of existingChildren) {
    if (STRUCTURED_TYPES.has(node.type)) {
      if (seen.has(node.type)) continue;
      seen.add(node.type);
    }
    deduped.push(node);
  }

  // Step 2: collect top-level structured nodes from input (last wins
  // if input has duplicates — predictable for the agent).
  const inputStructured = new Map<string, DocNode>();
  for (const node of input.content ?? []) {
    if (STRUCTURED_TYPES.has(node.type)) {
      inputStructured.set(node.type, structuredClone(node) as DocNode);
    }
  }

  // Step 3: upsert each input structured node.
  const merged: DocNode[] = [];
  const usedTypes = new Set<string>();
  for (const node of deduped) {
    if (STRUCTURED_TYPES.has(node.type) && inputStructured.has(node.type)) {
      const replacement = inputStructured.get(node.type)!;
      // Replace content in place, preserving position.
      merged.push({ ...node, content: replacement.content ?? [] });
      usedTypes.add(node.type);
    } else {
      merged.push(node);
    }
  }
  // Append any input structured nodes that had no existing counterpart.
  for (const [type, node] of inputStructured.entries()) {
    if (!usedTypes.has(type)) {
      merged.push(node);
    }
  }

  return { type: existing.type ?? "doc", content: merged };
}

// ─── upsertPageSection ───────────────────────────────────────────────
// Section-aware HTML read/merge/write for task pages.
// Finds or creates H2 sections by name. Preserves other sections.

export async function upsertPageSection(
  pageId: string,
  sectionName: string,
  sectionHtml: string,
  append: boolean = false,
): Promise<void> {
  const existingHtml = (await getPageContentAsHtml(pageId)) || "";

  const newHtml = mergeSectionIntoHtml(existingHtml, sectionName, sectionHtml, append);
  await setPageContentFromHtml(pageId, newHtml);
}

export function mergeSectionIntoHtml(
  existingHtml: string,
  sectionName: string,
  sectionHtml: string,
  append: boolean = false,
): string {
  // Parse HTML into sections by H2 boundaries
  const sections = splitByH2(existingHtml);

  const targetIndex = sections.findIndex(
    (s) => s.heading?.toLowerCase() === sectionName.toLowerCase(),
  );

  if (targetIndex >= 0) {
    if (append) {
      // Append new content after existing section content
      sections[targetIndex] = {
        heading: sectionName,
        html: `${sections[targetIndex].html}${sectionHtml}`,
      };
    } else {
      // Replace existing section
      const sectionBlock = `<h2>${sectionName}</h2>${sectionHtml}`;
      sections[targetIndex] = { heading: sectionName, html: sectionBlock };
    }
  } else {
    // Append new section
    const sectionBlock = `<h2>${sectionName}</h2>${sectionHtml}`;
    sections.push({ heading: sectionName, html: sectionBlock });
  }

  return sections.map((s) => s.html).join("");
}

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
