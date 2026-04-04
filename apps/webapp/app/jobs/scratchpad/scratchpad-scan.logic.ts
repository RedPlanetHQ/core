/**
 * Scratchpad Scan Job Logic
 *
 * Both mention and proactive flows run the same observer agent.
 * The delay difference (10s vs 20s) is handled in collab-scanner.server.ts.
 */

import { runScratchpadObserver } from "~/services/agent/agents/scratchpad-observer";
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
    await runScratchpadObserver({
      pageId: payload.pageId,
      userId: payload.userId,
      workspaceId: payload.workspaceId,
    });
  } catch (err) {
    logger.error(`[scratchpad] ${payload.type} job failed`, { err });
    throw err;
  }
}
