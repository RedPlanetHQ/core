/**
 * `POST /api/v1/internal/conversation-events`
 *
 * Server-side end of the trigger.dev → webapp pubsub bridge. A trigger
 * worker runs against its own Redis, so `publishRowEvent` there can't
 * reach the SSE subscribers on `conv:{conversationId}`; it POSTs the
 * envelope here instead and this route does the PUBLISH in-process.
 *
 * Auth is a shared secret (`INTERNAL_EVENTS_SECRET`), not the API-key
 * flow `internal.coding-events` uses: that authenticates a *user*, and a
 * background worker publishing on behalf of a job has no user context.
 * The envelope carries no authority of its own — worst case a leaked
 * secret lets someone nudge a client to refetch a conversation it can
 * already read (the SSE route still does its own ownership check).
 *
 * Responds with the Redis receiver count so the worker's
 * "receiverCount: 0 means nobody was listening" diagnostic survives the
 * extra hop.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "~/env.server";
import {
  publishRowEventToRedis,
  type ConversationRowEvent,
} from "~/services/conversation-pubsub.server";
import { logger } from "~/services/logger.service";

const EventSchema = z.object({
  type: z.literal("row-upsert"),
  rowId: z.string().min(1),
  conversationId: z.string().min(1),
  agentId: z.string().nullish(),
  status: z.string().nullish(),
  ts: z.number(),
});

/** Length-guarded constant-time compare. `timingSafeEqual` throws on
 *  length mismatch, and the length itself isn't worth protecting. */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, { status: 405 });
  }

  const expected = env.INTERNAL_EVENTS_SECRET;
  if (!expected) {
    logger.error(
      "internal conversation-events: INTERNAL_EVENTS_SECRET not configured — bridge is off",
    );
    return json({ error: "bridge not configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !secretMatches(presented, expected)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = EventSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      { error: "invalid event", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const receiverCount = await publishRowEventToRedis(
      parsed.data as ConversationRowEvent,
    );
    return json({ ok: true, receiverCount });
  } catch (err) {
    // The worker swallows this, but a 500 gets it into both logs — and
    // it's the honest status: we accepted the event and failed to fan out.
    logger.error("internal conversation-events: publish failed", {
      error: err instanceof Error ? err.message : String(err),
      conversationId: parsed.data.conversationId,
      rowId: parsed.data.rowId,
    });
    return json({ error: "publish failed" }, { status: 500 });
  }
}
