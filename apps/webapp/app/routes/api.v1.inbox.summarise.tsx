/**
 * Inbox — summarise and clear.
 *
 *   POST /api/v1/inbox/summarise
 *     body: { mode?: "voice" | "text" }
 *     → { summary, count }
 *
 * Loads the user's inbox, runs it through the shared summariser in the
 * requested mode (defaults to "voice" since the Mac pill is the only caller
 * today), deletes the rows, and returns the spoken/displayed text.
 *
 * Every catchup — single or multi — goes through the summariser. The voice
 * prompt is already tuned for short single-item catchups, and skipping the
 * LLM for one row meant the user heard the raw agent message verbatim,
 * which is too long for a butler-style update.
 */

import { json } from "@remix-run/node";
import { z } from "zod";

import { UserTypeEnum } from "@core/types";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { summarize } from "~/services/summarize.server";
import { upsertConversationHistory } from "~/services/conversation.server";
import { getOrCreateQuickChat } from "~/services/voice-conversation.server";
import { logger } from "~/services/logger.service";

const BodySchema = z.object({
  mode: z.enum(["voice", "text"]).optional(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    body: BodySchema,
    allowJWT: true,
    corsStrategy: "all",
    method: "POST",
  },
  async ({ body, authentication }) => {
    const userId = authentication.userId;
    const workspaceId = authentication.workspaceId as string | undefined;
    const mode = body.mode ?? "voice";

    const items = await prisma.voiceInboxMessage.findMany({
      where: { userId, checked: null },
      orderBy: { createdAt: "asc" },
      include: { task: { select: { title: true, displayId: true } } },
    });

    if (items.length === 0) {
      return json({ summary: "", count: 0 });
    }

    const rendered = items
      .map((it, idx) => {
        const taskTag = it.task?.title ? ` [task: ${it.task.title}]` : "";
        return `${idx + 1}.${taskTag} ${it.message}`;
      })
      .join("\n");
    const summary = await summarize({ text: rendered, mode });

    // Stamp instead of delete: the rows stay around as a history of
    // what the user has been caught up on. Only unstamped rows are
    // surfaced by the badge / next summarise pass.
    await prisma.voiceInboxMessage.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { checked: new Date() },
    });

    // Append the catchup to today's Quick Chat as an Agent turn so the
    // user can scroll back and re-read what was just spoken to them. We
    // never block the response on this — if the workspace isn't on the
    // auth payload (some token paths) or the write fails, the catchup
    // still goes out.
    if (summary && workspaceId) {
      try {
        const conversationId = await getOrCreateQuickChat(workspaceId, userId);
        await upsertConversationHistory(
          crypto.randomUUID(),
          [{ type: "text", text: summary }],
          conversationId,
          UserTypeEnum.Agent,
        );
      } catch (error) {
        logger.warn("[inbox.summarise] failed to append summary to Quick Chat", {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
    }

    return json({ summary, count: items.length });
  },
);

// Re-export individually rather than `export const { ... } = ...` so
// Remix's vite plugin can isolate the server-only modules. The
// destructured-in-export pattern leaves the entire return value of
// createHybridActionApiRoute looking like a client-side import to the
// analyzer, which then rejects the apiBuilder.server import.
export { loader, action };
