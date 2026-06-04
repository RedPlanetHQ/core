/**
 * Inbox — read the per-user bucket of unchecked agent send_message outputs.
 *
 *   GET /api/v1/inbox?limit=20
 *     → { count, items: [{ id, message, taskId, channelType, createdAt }] }
 *
 * Drives the pill: `count` is the badge number, `items` lets the UI show a
 * peek list before the user clicks. The summarise route stamps `checked`
 * instead of deleting, so this endpoint filters `checked IS NULL` to surface
 * only what's still unread.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";

const SearchParamsSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateHybridRequest(request, { allowJWT: true });
  if (!auth) {
    return json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = SearchParamsSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: "Invalid query params" }, { status: 400 });
  }

  const limit = parsed.data.limit ?? 20;
  const userId = auth.userId;

  // Only unchecked rows count toward the badge. Summarise stamps
  // `checked` instead of deleting so historical rows live in the
  // same table — they just don't show up here.
  const where = { userId, checked: null } as const;

  const [count, items] = await Promise.all([
    prisma.voiceInboxMessage.count({ where }),
    prisma.voiceInboxMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        message: true,
        taskId: true,
        channelType: true,
        createdAt: true,
        task: { select: { displayId: true, title: true } },
      },
    }),
  ]);

  return json({ count, items });
}
