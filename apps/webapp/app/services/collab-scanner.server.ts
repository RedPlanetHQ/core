/**
 * Server-side scratchpad scanner.
 *
 * Uses two Hocuspocus hooks:
 * - onChange: captures baseline snapshot + tracks mentions (fires per keystroke, no I/O)
 * - onStoreDocument: detects changes, enqueues jobs (fires once per debounce, 3s idle / 10s max)
 *
 * Two paths:
 * 1. Mentions (@butler) → enqueue with 10s delay
 * 2. Proactive → enqueue with 60s delay
 *
 * Heavy work (LLM, agent execution, Yjs tagging) runs in the queue job.
 */

import * as Y from "yjs";
import type { Hocuspocus } from "@hocuspocus/server";
import { logger } from "~/services/logger.service";
import { isButlerSnoozed } from "~/services/butler-activity.server";
import {
  enqueueScratchpadScan,
  cancelScratchpadScan,
} from "~/lib/queue-adapter.server";

// ── Hocuspocus reference ─────────────────────────────────────────────
let hocuspocusRef: Hocuspocus | null = null;

export function setHocuspocusRef(instance: Hocuspocus) {
  hocuspocusRef = instance;
}

export function getHocuspocusRef(): Hocuspocus | null {
  return hocuspocusRef;
}

// ── In-memory state ──────────────────────────────────────────────────
const processedMentions = new Map<string, Set<string>>();
const docSnapshots = new Map<string, string[]>();
// Tracks pages that have a pending proactive job in the queue
const pendingProactive = new Set<string>();

const MENTION_IDLE_MS = 10_000;
const PROACTIVE_IDLE_MS = 60_000;

/** Called by the job when it starts executing — clears the pending flag */
export function clearPendingProactive(pageId: string) {
  pendingProactive.delete(pageId);
}

/** Clean up in-memory state when a document is closed */
export function cleanupPage(pageId: string) {
  processedMentions.delete(pageId);
  docSnapshots.delete(pageId);
  pendingProactive.delete(pageId);
  cancelScratchpadScan(pageId).catch(() => { });
}

// ── Yjs tree walker ──────────────────────────────────────────────────

interface ScanResult {
  mentions: { instruction: string; mentionKey: string; fragmentIndex: number }[];
  paragraphs: { text: string; fragmentIndex: number }[];
}

function scanYjsFragment(fragment: Y.XmlFragment): ScanResult {
  const mentions: ScanResult["mentions"] = [];
  const paragraphs: ScanResult["paragraphs"] = [];
  let idx = 0;

  fragment.forEach((child) => {
    if (!(child instanceof Y.XmlElement)) { idx++; return; }

    let hasMention = false;
    let mentionId = "";
    const textParts: string[] = [];

    child.forEach((inline) => {
      if (inline instanceof Y.XmlElement && inline.nodeName === "mention") {
        hasMention = true;
        mentionId = inline.getAttribute("id") ?? "";
      } else if (inline instanceof Y.XmlText) {
        textParts.push(inline.toString());
      }
    });

    const paraText = textParts.join("").trim();
    if (paraText) paragraphs.push({ text: paraText, fragmentIndex: idx });

    if (hasMention) {
      const instruction = paraText.replace(/@\S+/g, "").trim();
      if (instruction) {
        mentions.push({ instruction, mentionKey: `${mentionId}-${instruction}`, fragmentIndex: idx });
      }
    }

    idx++;
  });

  return { mentions, paragraphs };
}

// ── onChange handler (fires per keystroke — lightweight, no I/O) ──────

export function handleScratchpadChange(
  pageId: string,
  document: Y.Doc,
  context: { workspaceId: string; userId: string } | null,
) {
  if (!context?.workspaceId || !context?.userId) return;

  const fragment = document.getXmlFragment("default");
  const { mentions, paragraphs } = scanYjsFragment(fragment);
  const nonMentionTexts = paragraphs
    .filter((p) => !p.text.includes("@"))
    .map((p) => p.text);

  if (!processedMentions.has(pageId)) {
    processedMentions.set(pageId, new Set());
  }
  const processed = processedMentions.get(pageId)!;

  // Capture baseline on first call — don't update after that until job clears pendingProactive
  if (!docSnapshots.has(pageId)) {
    docSnapshots.set(pageId, nonMentionTexts);
    for (const { mentionKey } of mentions) {
      processed.add(mentionKey);
    }
    logger.debug(`[scratchpad] baseline set page=${pageId} paragraphs=${nonMentionTexts.length}`);
    return;
  }

}

// ── onStoreDocument handler (fires once per debounce — does Redis I/O) ──

export async function handleScratchpadStore(
  pageId: string,
  document: Y.Doc,
  context: { workspaceId: string; userId: string } | null,
) {
  if (!context?.workspaceId || !context?.userId) return;

  const { userId, workspaceId } = context;

  const fragment = document.getXmlFragment("default");
  const { mentions, paragraphs } = scanYjsFragment(fragment);
  const nonMentionParagraphs = paragraphs.filter((p) => !p.text.includes("@"));

  if (!processedMentions.has(pageId)) {
    processedMentions.set(pageId, new Set());
  }
  const processed = processedMentions.get(pageId)!;

  // If no baseline yet (page just opened), set it and return
  if (!docSnapshots.has(pageId)) {
    docSnapshots.set(pageId, nonMentionParagraphs.map((p) => p.text));
    for (const { mentionKey } of mentions) {
      processed.add(mentionKey);
    }
    return;
  }

  // ── Mention detection ──
  const newMentions = mentions.filter((m) => !processed.has(m.mentionKey));

  if (newMentions.length > 0) {
    for (const { instruction, mentionKey, fragmentIndex } of newMentions) {
      processed.add(mentionKey);

      try {
        await cancelScratchpadScan(pageId);
        await enqueueScratchpadScan(
          {
            type: "mention",
            pageId,
            userId,
            workspaceId,
            instruction,
            mentionFragmentIndex: fragmentIndex,
          },
          MENTION_IDLE_MS,
        );
        logger.debug(`[scratchpad] mention enqueued page=${pageId} instruction="${instruction.slice(0, 60)}"`);
      } catch (err) {
        logger.error("[scratchpad] Failed to enqueue mention scan", { err });
      }
    }
    return;
  }

  // ── Proactive detection ──
  if (await isButlerSnoozed(workspaceId)) {
    docSnapshots.set(pageId, nonMentionParagraphs.map((p) => p.text));
    await cancelScratchpadScan(pageId).catch(() => { });
    return;
  }

  const previousSnapshot = docSnapshots.get(pageId)!;
  const previousSet = new Set(previousSnapshot);
  const currentTexts = nonMentionParagraphs.map((p) => p.text);
  const currentSet = new Set(currentTexts);
  const hasChanges =
    previousSnapshot.length !== currentTexts.length ||
    currentTexts.some((t) => !previousSet.has(t)) ||
    previousSnapshot.some((t) => !currentSet.has(t));

  logger.info(`[scratchpad] proactive check page=${pageId} prev=${previousSnapshot.length} curr=${currentTexts.length} hasChanges=${hasChanges}`);
  if (!hasChanges) return;

  try {
    await cancelScratchpadScan(pageId);
    pendingProactive.add(pageId);
    await enqueueScratchpadScan(
      {
        type: "proactive",
        pageId,
        userId,
        workspaceId,
        previousParagraphs: previousSnapshot,
        currentParagraphs: currentTexts,
        currentFragmentIndices: nonMentionParagraphs.map((p) => p.fragmentIndex),
      },
      PROACTIVE_IDLE_MS,
    );
    // Update baseline so next burst compares against what was just enqueued
    docSnapshots.set(pageId, currentTexts);
    logger.debug(`[scratchpad] proactive enqueued page=${pageId}`);
  } catch (err) {
    pendingProactive.delete(pageId);
    logger.error("[scratchpad] Failed to enqueue proactive scan", { err });
  }
}
