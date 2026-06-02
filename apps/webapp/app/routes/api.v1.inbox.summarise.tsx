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
 * One-message short-circuit: when there's exactly one row we skip the LLM
 * call and return the message verbatim — no summarisation needed.
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

    let summary: string;
    if (items.length === 1) {
      summary = items[0].message;
    } else {
      const rendered = items
        .map((it, idx) => {
          const taskTag = it.task?.title
            ? ` [task: ${it.task.title}]`
            : "";
          return `${idx + 1}.${taskTag} ${it.message}`;
        })
        .join("\n");
      summary = await summarize({ text: rendered, mode });
    }

    await prisma.voiceInboxMessage.deleteMany({
      where: { id: { in: items.map((i) => i.id) } },
    });

    return json({ summary, count: items.length });
  },
);
