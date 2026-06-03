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

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { summarize } from "~/services/summarize.server";

const BodySchema = z.object({
  mode: z.enum(["voice", "text"]).optional(),
});

export const { action } = createHybridActionApiRoute(
  {
    body: BodySchema,
    allowJWT: true,
    corsStrategy: "all",
    method: "POST",
  },
  async ({ body, authentication }) => {
    const userId = authentication.userId;
    const mode = body.mode ?? "voice";

    const items = await prisma.voiceInboxMessage.findMany({
      where: { userId },
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

    await prisma.voiceInboxMessage.deleteMany({
      where: { id: { in: items.map((i) => i.id) } },
    });

    return json({ summary, count: items.length });
  },
);
