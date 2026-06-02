/**
 * Inbox — read the per-user bucket of agent send_message outputs.
 *
 *   GET /api/v1/inbox?limit=20
 *     → { count, items: [{ id, message, taskId, channelType, createdAt }] }
 *
 * Drives the pill: `count` is the badge number, `items` lets the UI show a
 * peek list before the user clicks. Clearing happens on the summarise call
 * (api.v1.inbox.summarise), not here — this endpoint is read-only.
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

  const [count, items] = await Promise.all([
    prisma.voiceInboxMessage.count({ where: { userId } }),
    prisma.voiceInboxMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        message: true,
        taskId: true,
        channelType: true,
        createdAt: true,
      },
    }),
  ]);

  return json({ count, items });
}
