/**
 * Server-side scratchpad scanner.
 *
 * Runs inside the Hocuspocus onChange hook to detect @mentions
 * and proactive text — replaces all client-side detection.
 *
 * Two paths:
 * 1. Mentions (@butler) → direct conversation + agent with add_comment tool
 * 2. Proactive diff → decision prompt → classify intents → per-intent conversations
 *    → attach conversationId to paragraph XmlElement in Yjs
 */

import * as Y from "yjs";
import type { Hocuspocus } from "@hocuspocus/server";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { classifyScratchpadIntents } from "~/services/agent/prompts/scratchpad-decision";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { logger } from "~/services/logger.service";

// ── Hocuspocus reference (set from websocket.ts) ───────────────────────
let hocuspocusRef: Hocuspocus | null = null;

export function setHocuspocusRef(instance: Hocuspocus) {
  hocuspocusRef = instance;
}

export function getHocuspocusRef(): Hocuspocus | null {
  return hocuspocusRef;
}

// ── State ───────────────────────────────────────────────────────────────
// Track processed mentions per document to avoid re-triggering
const processedMentions = new Map<string, Set<string>>();

// Debounce mention triggers — wait for user to stop typing before firing
const mentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MENTION_IDLE_MS = 10_000; // 10s idle before processing mentions

// Proactive scan: snapshot-based diff + debounce
// Stores previous paragraph texts per page — used to compute what changed
const docSnapshots = new Map<string, string[]>();
const proactiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PROACTIVE_IDLE_MS = 60_000;

/** Clean up in-memory state when a document is closed (no more connections) */
export function cleanupPage(pageId: string) {
  processedMentions.delete(pageId);
  const mt = mentionTimers.get(pageId);
  if (mt) clearTimeout(mt);
  mentionTimers.delete(pageId);
  const pt = proactiveTimers.get(pageId);
  if (pt) clearTimeout(pt);
  proactiveTimers.delete(pageId);
  docSnapshots.delete(pageId);
}

// ── Yjs tree walker ─────────────────────────────────────────────────────

interface ScanResult {
  mentions: { instruction: string; mentionKey: string }[];
  paragraphs: string[];
}

/**
 * Walk a Yjs XmlFragment to find mention nodes and extract paragraph text.
 */
function scanYjsFragment(fragment: Y.XmlFragment): ScanResult {
  const mentions: ScanResult["mentions"] = [];
  const paragraphs: string[] = [];

  fragment.forEach((child) => {
    if (!(child instanceof Y.XmlElement)) return;

    let hasMention = false;
    let mentionId = "";
    const textParts: string[] = [];
    let hasCommentMark = false;

    child.forEach((inline) => {
      if (inline instanceof Y.XmlElement && inline.nodeName === "mention") {
        hasMention = true;
        mentionId = inline.getAttribute("id") ?? "";
      } else if (inline instanceof Y.XmlText) {
        textParts.push(inline.toString());
        // Check if any text already has a butlerComment format
        const delta = inline.toDelta();
        for (const op of delta) {
          if (op.attributes?.butlerComment) {
            hasCommentMark = true;
          }
        }
      }
    });

    const paraText = textParts.join("").trim();
    if (paraText) paragraphs.push(paraText);

    if (hasMention && !hasCommentMark) {
      const instruction = paraText.replace(/@\S+/g, "").trim();
      if (instruction) {
        const mentionKey = `${mentionId}-${instruction}`;
        mentions.push({ instruction, mentionKey });
      }
    }
  });

  return { mentions, paragraphs };
}

// ── Mention agent trigger (direct — no decision layer) ──────────────────

async function triggerMentionAgent(
  pageId: string,
  message: string,
  document: Y.Doc,
  userId: string,
  workspaceId: string,
) {
  logger.info(`[scratchpad] Mention trigger page=${pageId} message="${message.slice(0, 100)}"`);

  try {
    const result = await createConversation(workspaceId, userId, {
      message,
      source: "daily",
      parts: [{ text: message, type: "text" }],
    });

    // Attach conversationId to the mention paragraph in Yjs
    attachConversationToYdoc(document, [message], result.conversationId);

    noStreamProcess(
      {
        id: result.conversationId,
        message: { parts: [{ text: message, type: "text" }], role: "user" },
        source: "daily",
        scratchpadPageId: pageId,
      },
      userId,
      workspaceId,
    ).catch((err) =>
      logger.error("[scratchpad] Mention agent processing failed", err),
    );
  } catch (err) {
    logger.error("[scratchpad] Failed to create mention conversation", err);
  }
}

// ── Proactive decision trigger ──────────────────────────────────────────

/**
 * Run the decision prompt on proactive diff, then create conversations
 * for each actionable intent and attach conversationId to paragraphs in Yjs.
 */
async function triggerProactiveDecision(
  pageId: string,
  diffParagraphs: string[],
  fullPageParagraphs: string[],
  document: Y.Doc,
  userId: string,
  workspaceId: string,
) {
  logger.info(`[scratchpad] Proactive decision page=${pageId} diff=${diffParagraphs.length} paragraphs`);

  try {
    // Load connected integrations for the decision prompt
    const integrationAccounts = await IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId);
    const connectedIntegrations = integrationAccounts.map((int) =>
      "integrationDefinition" in int ? int.integrationDefinition.name : int.name,
    );

    // Step 1: Classify intents via lightweight LLM call
    const { intents } = await classifyScratchpadIntents(
      diffParagraphs,
      fullPageParagraphs,
      connectedIntegrations,
      workspaceId,
    );

    const actionableIntents = intents.filter((i) => i.actionable);
    logger.info(`[scratchpad] Decision: ${intents.length} intents, ${actionableIntents.length} actionable`);

    if (actionableIntents.length === 0) return;

    // Step 2: For each actionable intent, create a conversation and run agent
    for (const intent of actionableIntents) {
      try {
        const result = await createConversation(workspaceId, userId, {
          message: intent.intent,
          source: "daily",
          parts: [{ text: intent.intent, type: "text" }],
        });

        // Map LLM's 1-based indices back to original diff paragraph text
        const sourceParagraphs = intent.paragraphIndices
          .map((i) => diffParagraphs[i - 1])
          .filter(Boolean);

        // Attach conversationId to matching paragraph(s) in Yjs using containment match
        attachConversationToYdoc(document, sourceParagraphs, result.conversationId);

        // Fire agent processing with scratchpad context
        noStreamProcess(
          {
            id: result.conversationId,
            message: { parts: [{ text: intent.intent, type: "text" }], role: "user" },
            source: "daily",
            scratchpadPageId: pageId,
          },
          userId,
          workspaceId,
        ).catch((err) =>
          logger.error(`[scratchpad] Proactive agent failed for intent="${intent.intent.slice(0, 60)}"`, err),
        );
      } catch (err) {
        logger.error(`[scratchpad] Failed to create conversation for intent="${intent.intent.slice(0, 60)}"`, err);
      }
    }
  } catch (err) {
    logger.error("[scratchpad] Decision prompt failed", err);
  }
}

// ── Main onChange handler ───────────────────────────────────────────────

export async function handleScratchpadChange(
  pageId: string,
  document: Y.Doc,
  context: unknown,
) {
  const auth = context as { workspaceId: string; userId: string } | null;
  if (!auth?.workspaceId || !auth?.userId) return;

  const fragment = document.getXmlFragment("default");
  const { mentions, paragraphs } = scanYjsFragment(fragment);
  const nonMentionParagraphs = paragraphs.filter((p) => !p.includes("@"));

  // Ensure processedMentions exists for this page
  if (!processedMentions.has(pageId)) {
    processedMentions.set(pageId, new Set());
  }
  const processed = processedMentions.get(pageId)!;

  // ── First onChange after start/restart: capture baseline, don't trigger ──
  if (!docSnapshots.has(pageId)) {
    docSnapshots.set(pageId, nonMentionParagraphs);
    // Seed existing mentions as already processed so they don't re-trigger
    for (const { mentionKey } of mentions) {
      processed.add(mentionKey);
    }
    return;
  }

  // ── Mention detection (debounced) ──
  const existingMentionTimer = mentionTimers.get(pageId);
  if (existingMentionTimer) clearTimeout(existingMentionTimer);

  const newMentions = mentions.filter((m) => !processed.has(m.mentionKey));

  if (newMentions.length > 0) {
    // Schedule mention processing after user stops typing
    mentionTimers.set(
      pageId,
      setTimeout(() => {
        mentionTimers.delete(pageId);

        // Re-scan to get final state of the doc (not stale closure)
        const freshFragment = document.getXmlFragment("default");
        const fresh = scanYjsFragment(freshFragment);
        const freshNew = fresh.mentions.filter(
          (m) => !processed.has(m.mentionKey),
        );

        for (const { instruction, mentionKey } of freshNew) {
          processed.add(mentionKey);
          triggerMentionAgent(pageId, instruction, document, auth.userId, auth.workspaceId);
        }
      }, MENTION_IDLE_MS),
    );

    // Don't start proactive scan while new mentions are pending
    const existingTimer = proactiveTimers.get(pageId);
    if (existingTimer) clearTimeout(existingTimer);
    proactiveTimers.delete(pageId);
    return;
  }

  const previousSnapshot = docSnapshots.get(pageId)!;
  const previousSet = new Set(previousSnapshot);

  // Only update snapshot when no proactive timer is pending
  if (!proactiveTimers.has(pageId)) {
    docSnapshots.set(pageId, nonMentionParagraphs);
  }

  // Diff: paragraphs that are new or modified (not in previous snapshot)
  const diffParagraphs = nonMentionParagraphs.filter(
    (p) => !previousSet.has(p),
  );

  if (diffParagraphs.length === 0) return;

  // Reset idle timer on every change
  const existingTimer = proactiveTimers.get(pageId);
  if (existingTimer) clearTimeout(existingTimer);

  proactiveTimers.set(
    pageId,
    setTimeout(() => {
      proactiveTimers.delete(pageId);

      // Re-scan for final state
      const freshFragment = document.getXmlFragment("default");
      const fresh = scanYjsFragment(freshFragment);
      const freshNonMention = fresh.paragraphs.filter(
        (p) => !p.includes("@"),
      );
      const freshDiff = freshNonMention.filter((p) => !previousSet.has(p));

      if (freshDiff.length === 0) return;

      // Update snapshot to latest
      docSnapshots.set(pageId, freshNonMention);

      // Send through decision prompt instead of direct agent trigger
      triggerProactiveDecision(
        pageId,
        freshDiff,
        freshNonMention,
        document,
        auth.userId,
        auth.workspaceId,
      );
    }, PROACTIVE_IDLE_MS),
  );
}

// ── Yjs attribute helpers ──────────────────────────────────────────────

/**
 * Attach a conversationId attribute to paragraph XmlElements in the Yjs doc.
 * Matches paragraphs by their text content. Syncs to all clients via CRDT.
 */
function attachConversationToYdoc(
  ydoc: Y.Doc,
  paragraphTexts: string[],
  conversationId: string,
): void {
  const fragment = ydoc.getXmlFragment("default");
  let matched = 0;

  ydoc.transact(() => {
    fragment.forEach((child) => {
      if (!(child instanceof Y.XmlElement)) return;

      const textParts: string[] = [];
      child.forEach((inline) => {
        if (inline instanceof Y.XmlText) {
          textParts.push(inline.toString());
        }
      });
      const paraText = textParts.join("").trim();
      if (!paraText) return;

      // Containment match — handles user editing paragraph during LLM call
      const isMatch = paragraphTexts.some(
        (target) => paraText.includes(target) || target.includes(paraText),
      );

      if (isMatch) {
        child.setAttribute("conversationId", conversationId);
        matched++;
      }
    });
  }, "server-conversation-attach");

  logger.info(`[scratchpad] attachConversation: matched=${matched}/${paragraphTexts.length} conversationId=${conversationId}`);
}

/**
 * Apply a butlerComment mark directly into the live Yjs document.
 * Called from add_comment tool after DB write — syncs to clients via CRDT.
 */
export function applyCommentMarkToYdoc(
  ydoc: Y.Doc,
  selectedText: string,
  commentId: string,
): boolean {
  const fragment = ydoc.getXmlFragment("default");
  let found = false;

  ydoc.transact(() => {
    fragment.forEach((child) => {
      if (found) return;
      if (!(child instanceof Y.XmlElement)) return;

      child.forEach((inline) => {
        if (found) return;
        if (!(inline instanceof Y.XmlText)) return;

        const text = inline.toString();
        const index = text.indexOf(selectedText);
        if (index === -1) return;

        // Apply the mark as Yjs text formatting
        inline.format(index, selectedText.length, {
          butlerComment: { commentId },
        });
        found = true;
      });
    });
  }, "server-comment");

  return found;
}
