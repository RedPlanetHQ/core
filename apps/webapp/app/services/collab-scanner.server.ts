/**
 * Server-side scratchpad scanner (stateless).
 *
 * Called from the Hocuspocus Database.store callback on every debounced save.
 * No in-memory state — all dedup uses Yjs attributes (conversationId on paragraphs).
 * Baseline for proactive diffs comes from `butlerLastSeen` column in the Page table.
 *
 * Two paths:
 * 1. Mentions (@butler without conversationId) → cancel + enqueue with 10s delay
 * 2. Proactive → cancel + enqueue with 60s delay
 */

import * as Y from "yjs";
import { logger } from "~/services/logger.service";
import { isButlerSnoozed } from "~/services/butler-activity.server";
import {
  enqueueScratchpadScan,
  cancelScratchpadScan,
} from "~/lib/queue-adapter.server";

const MENTION_IDLE_MS = 10_000;
const PROACTIVE_IDLE_MS = 60_000;

/** Cancel any pending scratchpad jobs when a document is closed */
export function cleanupPage(pageId: string) {
  cancelScratchpadScan(pageId).catch(() => {});
}

// ── Yjs tree walker ──────────────────────────────────────────────────

interface MentionResult {
  instruction: string;
  fragmentIndex: number;
}

/**
 * Scan a Yjs fragment for @butler mentions that don't already have a conversationId.
 * Returns only unprocessed mentions.
 */
function scanForUnprocessedMentions(fragment: Y.XmlFragment): MentionResult[] {
  const mentions: MentionResult[] = [];
  let idx = 0;

  fragment.forEach((child) => {
    if (!(child instanceof Y.XmlElement)) { idx++; return; }

    // Skip paragraphs already tagged with a conversationId
    const existingConversationId = child.getAttribute("conversationId");
    if (existingConversationId) { idx++; return; }

    let hasMention = false;
    const textParts: string[] = [];

    child.forEach((inline) => {
      if (inline instanceof Y.XmlElement && inline.nodeName === "mention") {
        hasMention = true;
      } else if (inline instanceof Y.XmlText) {
        textParts.push(inline.toString());
      }
    });

    if (hasMention) {
      const paraText = textParts.join("").trim();
      const instruction = paraText.replace(/@\S+/g, "").trim();
      if (instruction) {
        mentions.push({ instruction, fragmentIndex: idx });
      }
    }

    idx++;
  });

  return mentions;
}

// ── Store handler (called from Database.store callback) ──────────────

export async function handleScratchpadStore(
  pageId: string,
  document: Y.Doc,
  context: { workspaceId: string; userId: string },
) {
  const { userId, workspaceId } = context;

  const fragment = document.getXmlFragment("default");

  // ── Mention detection ──
  const unprocessedMentions = scanForUnprocessedMentions(fragment);

  if (unprocessedMentions.length > 0) {
    // Take the first unprocessed mention — process one at a time
    const { instruction } = unprocessedMentions[0];

    try {
      await cancelScratchpadScan(pageId);
      await enqueueScratchpadScan(
        {
          type: "mention",
          pageId,
          userId,
          workspaceId,
          instruction,
        },
        MENTION_IDLE_MS,
      );
      logger.debug(`[scratchpad] mention enqueued page=${pageId} instruction="${instruction.slice(0, 60)}"`);
    } catch (err) {
      logger.error("[scratchpad] Failed to enqueue mention scan", { err });
    }
    return;
  }

  // ── Proactive detection ──
  if (await isButlerSnoozed(workspaceId)) {
    await cancelScratchpadScan(pageId).catch(() => {});
    return;
  }

  try {
    await cancelScratchpadScan(pageId);
    await enqueueScratchpadScan(
      {
        type: "proactive",
        pageId,
        userId,
        workspaceId,
      },
      PROACTIVE_IDLE_MS,
    );
    logger.debug(`[scratchpad] proactive enqueued page=${pageId}`);
  } catch (err) {
    logger.error("[scratchpad] Failed to enqueue proactive scan", { err });
  }
}
