/**
 * Scratchpad Scan Job Logic
 *
 * - mention: direct → createConversation → createButlerComment → noStreamProcess
 * - proactive: observer agent decides → add_comment tool handles the rest
 *
 * The delay difference (10s vs 20s) is handled in collab-scanner.server.ts.
 */

import { runScratchpadObserver } from "~/services/agent/agents/scratchpad-observer";
import { createConversation } from "~/services/conversation.server";
import { createButlerComment } from "~/services/butler-comment.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
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

// ── Main processor ────────────────────────────────────────────────────────────

export async function processScratchpadScan(
  payload: ScratchpadScanPayload,
): Promise<void> {
  logger.info(`[scratchpad] ${payload.type} job page=${payload.pageId}`);

  try {
    if (payload.type === "mention") {
      await processMention(payload);
    } else {
      await runScratchpadObserver({
        pageId: payload.pageId,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
      });
    }
  } catch (err) {
    logger.error(`[scratchpad] ${payload.type} job failed`, { err });
    throw err;
  }
}

// ── Mention: direct to core agent ────────────────────────────────────────────

async function processMention(
  payload: Extract<ScratchpadScanPayload, { type: "mention" }>,
) {
  const { pageId, userId, workspaceId, instruction } = payload;

  const result = await createConversation(workspaceId, userId, {
    message: instruction,
    source: "daily",
    parts: [{ text: instruction, type: "text" }],
  });

  await createButlerComment(
    workspaceId,
    pageId,
    instruction,
    "",
    result.conversationId,
  );

  await noStreamProcess(
    {
      id: result.conversationId,
      message: {
        parts: [{ text: instruction, type: "text" }],
        role: "user",
      },
      source: "daily",
      scratchpadPageId: pageId,
      interactive: true,
    },
    userId,
    workspaceId,
  );
}
