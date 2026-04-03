/**
 * Scratchpad Scan Job Logic
 *
 * Runs in the BullMQ worker (separate process). All state comes from DB.
 *
 * - mention: read current doc from DB → find mention → createConversation → tag paragraph → noStreamProcess
 * - proactive: read current doc + butlerLastSeen from DB → extract paragraphs → LLM decision → act → update butlerLastSeen
 */

import * as Y from "yjs";
import { prisma } from "~/db.server";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { classifyScratchpadIntents } from "~/services/agent/prompts/scratchpad-decision";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { logger } from "~/services/logger.service";

// ── Payload types ─────────────────────────────────────────────────────────────

export type ScratchpadScanPayload =
  | {
      type: "mention";
      pageId: string;
      userId: string;
      workspaceId: string;
      instruction: string;
    }
  | {
      type: "proactive";
      pageId: string;
      userId: string;
      workspaceId: string;
    };

// ── Yjs helpers ───────────────────────────────────────────────────────────────

interface ScanResult {
  paragraphs: { text: string; fragmentIndex: number }[];
}

/** Load a Y.Doc from binary state (as stored in descriptionBinary) */
function loadYdocFromBinary(binary: Buffer | Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(binary));
  return doc;
}

/** Recursively extract all text from a Yjs element */
function extractTextFromElement(element: Y.XmlElement): { text: string; hasMention: boolean } {
  let hasMention = false;
  const textParts: string[] = [];

  element.forEach((child) => {
    if (child instanceof Y.XmlText) {
      textParts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === "mention") {
        hasMention = true;
      } else {
        const nested = extractTextFromElement(child);
        if (nested.text) textParts.push(nested.text);
        if (nested.hasMention) hasMention = true;
      }
    }
  });

  return { text: textParts.join("").trim(), hasMention };
}

/** Extract non-mention paragraph texts and their top-level fragment indices from a Yjs doc */
function extractParagraphs(doc: Y.Doc): ScanResult {
  const fragment = doc.getXmlFragment("default");
  const paragraphs: ScanResult["paragraphs"] = [];
  let idx = 0;

  fragment.forEach((child) => {
    if (!(child instanceof Y.XmlElement)) { idx++; return; }

    const { text, hasMention } = extractTextFromElement(child);
    if (text && !hasMention) {
      paragraphs.push({ text, fragmentIndex: idx });
    }

    idx++;
  });

  return { paragraphs };
}

/** Find the fragment index of a mention paragraph matching the instruction text */
function findMentionFragmentIndex(doc: Y.Doc, instruction: string): number | null {
  const fragment = doc.getXmlFragment("default");
  let idx = 0;

  let found: number | null = null;
  fragment.forEach((child) => {
    if (found !== null) { idx++; return; }
    if (!(child instanceof Y.XmlElement)) { idx++; return; }

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
      const paraInstruction = textParts.join("").trim().replace(/@\S+/g, "").trim();
      if (paraInstruction === instruction) {
        found = idx;
      }
    }

    idx++;
  });

  return found;
}

/**
 * Tag a paragraph in the Yjs doc with a conversationId and save back to DB.
 * This modifies descriptionBinary directly since the worker doesn't have Hocuspocus access.
 */
async function tagParagraphInDb(
  pageId: string,
  fragmentIndices: number[],
  conversationId: string,
): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { descriptionBinary: true },
  });
  if (!page?.descriptionBinary) return;

  const doc = loadYdocFromBinary(page.descriptionBinary);
  const fragment = doc.getXmlFragment("default");
  let tagged = 0;

  doc.transact(() => {
    for (const idx of fragmentIndices) {
      if (idx < 0 || idx >= fragment.length) continue;
      const child = fragment.get(idx);
      if (child instanceof Y.XmlElement) {
        child.setAttribute("conversationId", conversationId);
        tagged++;
      }
    }
  }, "server-conversation-attach");

  // Save modified doc back to DB
  const updatedBinary = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.page.update({
    where: { id: pageId },
    data: { descriptionBinary: updatedBinary },
  });

  logger.info(
    `[scratchpad] tagInDb: tagged=${tagged}/${fragmentIndices.length} conversationId=${conversationId}`,
  );
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processScratchpadScan(
  payload: ScratchpadScanPayload,
): Promise<void> {
  if (payload.type === "mention") {
    await processMention(payload);
  } else {
    await processProactive(payload);
  }
}

async function processMention(payload: Extract<ScratchpadScanPayload, { type: "mention" }>) {
  const { pageId, userId, workspaceId, instruction } = payload;

  logger.info(
    `[scratchpad] Mention job page=${pageId} message="${instruction.slice(0, 100)}"`,
  );

  try {
    const result = await createConversation(workspaceId, userId, {
      message: instruction,
      source: "daily",
      parts: [{ text: instruction, type: "text" }],
    });

    // Find the mention's current position in the doc and tag it
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { descriptionBinary: true },
    });

    if (page?.descriptionBinary) {
      const doc = loadYdocFromBinary(page.descriptionBinary);
      const fragmentIndex = findMentionFragmentIndex(doc, instruction);
      if (fragmentIndex !== null) {
        await tagParagraphInDb(pageId, [fragmentIndex], result.conversationId);
      } else {
        logger.warn(`[scratchpad] Mention: couldn't find paragraph for instruction="${instruction.slice(0, 60)}"`);
      }
    }

    await noStreamProcess(
      {
        id: result.conversationId,
        message: { parts: [{ text: instruction, type: "text" }], role: "user" },
        source: "daily",
        scratchpadPageId: pageId,
        interactive: true,
      },
      userId,
      workspaceId,
    );
  } catch (err) {
    logger.error("[scratchpad] Mention job failed", { err });
    throw err;
  }
}

async function processProactive(payload: Extract<ScratchpadScanPayload, { type: "proactive" }>) {
  const { pageId, userId, workspaceId } = payload;

  // Read current state and baseline from DB
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { descriptionBinary: true, butlerLastSeen: true },
  });

  if (!page?.descriptionBinary) {
    logger.warn(`[scratchpad] Proactive: no descriptionBinary for page=${pageId}`);
    return;
  }

  const currentDoc = loadYdocFromBinary(page.descriptionBinary);
  const { paragraphs: currentParagraphs } = extractParagraphs(currentDoc);
  const currentTexts = currentParagraphs.map((p) => p.text);
  const currentFragmentIndices = currentParagraphs.map((p) => p.fragmentIndex);

  // Extract previous paragraphs from butlerLastSeen, or use empty array (first time)
  let previousTexts: string[] = [];
  if (page.butlerLastSeen) {
    const prevDoc = loadYdocFromBinary(page.butlerLastSeen);
    const { paragraphs: prevParagraphs } = extractParagraphs(prevDoc);
    previousTexts = prevParagraphs.map((p) => p.text);
  }

  logger.debug(
    `[scratchpad] Proactive job page=${pageId} prev=${previousTexts.length} curr=${currentTexts.length}`,
  );

  try {
    const integrationAccounts =
      await IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId);
    const connectedIntegrations = integrationAccounts.map((int) =>
      "integrationDefinition" in int ? int.integrationDefinition.name : int.name,
    );

    const { intents } = await classifyScratchpadIntents(
      previousTexts,
      currentTexts,
      connectedIntegrations,
      workspaceId,
    );

    const actionableIntents = intents.filter((i) => i.actionable);
    logger.debug(
      `[scratchpad] Decision: ${intents.length} intents, ${actionableIntents.length} actionable`,
    );

    for (const intent of actionableIntents) {
      try {
        const result = await createConversation(workspaceId, userId, {
          message: intent.intent,
          source: "daily",
          parts: [{ text: intent.intent, type: "text" }],
        });

        // Map LLM 1-based indices → actual Yjs fragment indices
        const fragmentIndices = intent.paragraphIndices
          .map((i) => currentFragmentIndices[i - 1])
          .filter((i) => i !== undefined);
        await tagParagraphInDb(pageId, fragmentIndices, result.conversationId);

        await noStreamProcess(
          {
            id: result.conversationId,
            message: { parts: [{ text: intent.intent, type: "text" }], role: "user" },
            source: "daily",
            scratchpadPageId: pageId,
            interactive: true,
          },
          userId,
          workspaceId,
        );
      } catch (err) {
        logger.error(
          `[scratchpad] Proactive intent failed intent="${intent.intent.slice(0, 60)}"`,
          { err },
        );
      }
    }

    // Update butlerLastSeen to current state after processing
    await prisma.page.update({
      where: { id: pageId },
      data: { butlerLastSeen: Buffer.from(page.descriptionBinary) },
    });
    logger.debug(`[scratchpad] butlerLastSeen updated page=${pageId}`);
  } catch (err) {
    logger.error("[scratchpad] Proactive job failed", { err });
    throw err;
  }
}
