/**
 * Scratchpad Scan Job Logic
 *
 * Handles both mention and proactive scratchpad processing:
 * - mention: createConversation → tagParagraphsByIndex → noStreamProcess
 * - proactive: classifyScratchpadIntents → per-intent createConversation → tagParagraphsByIndex → noStreamProcess
 */

import * as Y from "yjs";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { classifyScratchpadIntents } from "~/services/agent/prompts/scratchpad-decision";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { logger } from "~/services/logger.service";
import {
  getHocuspocusRef,
  clearPendingProactive,
} from "~/services/collab-scanner.server";

// ── Payload types ─────────────────────────────────────────────────────────────

export type ScratchpadScanPayload =
  | {
    type: "mention";
    pageId: string;
    userId: string;
    workspaceId: string;
    instruction: string;
    mentionFragmentIndex: number;
  }
  | {
    type: "proactive";
    pageId: string;
    userId: string;
    workspaceId: string;
    previousParagraphs: string[];
    currentParagraphs: string[];
    // Actual fragment indices for each currentParagraph entry
    currentFragmentIndices: number[];
  };

// ── Yjs helpers ───────────────────────────────────────────────────────────────

function tagParagraphsByIndex(
  ydoc: Y.Doc,
  fragmentIndices: number[],
  conversationId: string,
): void {
  const fragment = ydoc.getXmlFragment("default");
  let tagged = 0;

  ydoc.transact(() => {
    for (const idx of fragmentIndices) {
      if (idx < 0 || idx >= fragment.length) continue;
      const child = fragment.get(idx);
      if (child instanceof Y.XmlElement) {
        child.setAttribute("conversationId", conversationId);
        tagged++;
      }
    }
  }, "server-conversation-attach");

  logger.info(
    `[scratchpad] tagByIndex: tagged=${tagged}/${fragmentIndices.length} conversationId=${conversationId}`,
  );
}

function getYdoc(pageId: string): Y.Doc | null {
  const hocuspocus = getHocuspocusRef();
  if (!hocuspocus) return null;
  const doc = hocuspocus.documents.get(pageId);
  return doc ?? null;
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processScratchpadScan(
  payload: ScratchpadScanPayload,
): Promise<void> {
  const { pageId, userId, workspaceId } = payload;

  if (payload.type === "mention") {
    await processMention(payload);
  } else {
    await processProactive(payload);
  }
}

async function processMention(payload: Extract<ScratchpadScanPayload, { type: "mention" }>) {
  const { pageId, userId, workspaceId, instruction, mentionFragmentIndex } = payload;

  logger.info(
    `[scratchpad] Mention job page=${pageId} message="${instruction.slice(0, 100)}"`,
  );

  try {
    const result = await createConversation(workspaceId, userId, {
      message: instruction,
      source: "daily",
      parts: [{ text: instruction, type: "text" }],
    });

    const ydoc = getYdoc(pageId);
    if (ydoc) {
      tagParagraphsByIndex(ydoc, [mentionFragmentIndex], result.conversationId);
    } else {
      logger.warn(`[scratchpad] Mention: no ydoc for page=${pageId}`);
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
  const { pageId, userId, workspaceId, previousParagraphs, currentParagraphs, currentFragmentIndices } = payload;

  // Clear pending flag so next burst gets a fresh baseline
  clearPendingProactive(pageId);

  logger.info(
    `[scratchpad] Proactive job page=${pageId} prev=${previousParagraphs.length} curr=${currentParagraphs.length}`,
  );

  try {
    const integrationAccounts =
      await IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId);
    const connectedIntegrations = integrationAccounts.map((int) =>
      "integrationDefinition" in int ? int.integrationDefinition.name : int.name,
    );

    const { intents } = await classifyScratchpadIntents(
      previousParagraphs,
      currentParagraphs,
      connectedIntegrations,
      workspaceId,
    );

    const actionableIntents = intents.filter((i) => i.actionable);
    logger.info(
      `[scratchpad] Decision: ${intents.length} intents, ${actionableIntents.length} actionable`,
    );

    if (actionableIntents.length === 0) return;

    const ydoc = getYdoc(pageId);

    for (const intent of actionableIntents) {
      try {
        const result = await createConversation(workspaceId, userId, {
          message: intent.intent,
          source: "daily",
          parts: [{ text: intent.intent, type: "text" }],
        });

        if (ydoc) {
          // LLM returns 1-based indices into currentParagraphs array
          // Map through currentFragmentIndices to get actual Yjs fragment indices
          const fragmentIndices = intent.paragraphIndices
            .map((i) => currentFragmentIndices[i - 1])
            .filter((i) => i !== undefined);
          tagParagraphsByIndex(ydoc, fragmentIndices, result.conversationId);
        } else {
          logger.warn(`[scratchpad] Proactive: no ydoc for page=${pageId}`);
        }

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
  } catch (err) {
    logger.error("[scratchpad] Proactive job failed", { err });
    throw err;
  }
}
