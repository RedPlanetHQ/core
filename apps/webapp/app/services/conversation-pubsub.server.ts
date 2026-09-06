/**
 * Redis pub/sub for conversation-history row events.
 *
 * Every write to `ConversationHistory` publishes a small envelope on
 * `conv:{conversationId}`. The SSE subscribe endpoint
 * (`/api/v1/conversation/:id/subscribe`) creates a subscriber per
 * connected client, forwards each envelope as an SSE `message` event,
 * and cleans up on client disconnect.
 *
 * Horizontal scale is baked in: any app instance can publish, any app
 * instance can subscribe — Redis handles fan-out. The pub/sub is
 * fire-and-forget (no persistence), which is fine because the DB row is
 * the source of truth. If a client's connection blips, they refetch
 * loader history on reconnect and pick up any missed rows.
 *
 * Dedicated `duplicate()` connections for publisher and per-subscriber
 * so pub/sub traffic doesn't contend with BullMQ commands on the shared
 * ioredis socket — same pattern as `getResumableStreamContext()`.
 *
 * ## Two transports
 *
 * Publishers don't all live in the webapp process. Jobs that run on
 * trigger.dev (`run-agent-turn`, `task`, `case`, `scratchpad-scan` — every
 * caller of `upsertConversationHistory`) execute in a separate runtime
 * wired to a DIFFERENT Redis. A `PUBLISH` from there succeeds and reaches
 * nobody, which surfaces as "conversation stuck on Working…, refresh shows
 * the reply". So `publishRowEvent` picks its transport by runtime:
 *
 *   webapp / BullMQ worker → PUBLISH straight onto the shared Redis
 *   trigger.dev worker     → POST the same envelope to the webapp, which
 *                            does the PUBLISH on the caller's behalf
 *                            (`/api/v1/internal/conversation-events`)
 *
 * Both branches stay fire-and-forget: a transport outage logs and is
 * swallowed, never failing the DB write that preceded it.
 */

import type { Redis } from "ioredis";
import { getRedisConnection } from "~/bullmq/connection";
import { env } from "~/env.server";
import { isRunningInTrigger } from "~/lib/runtime.server";
import { logger } from "~/services/logger.service";

const CHANNEL_PREFIX = "conv:";

/** Route the trigger.dev bridge POSTs to. Must match the resource route
 *  filename `api.v1.internal.conversation-events.tsx`. */
export const INTERNAL_EVENTS_PATH = "/api/v1/internal/conversation-events";

/** A worker blocked on a publish is a worker not finishing its run. The
 *  DB row is already committed by this point, so giving up is cheap. */
const HTTP_PUBLISH_TIMEOUT_MS = 5_000;

/** Envelope shape published on every ConversationHistory row upsert. Kept
 *  small — clients refetch the full row via loader if they need details
 *  beyond what's here. */
export interface ConversationRowEvent {
  type: "row-upsert";
  rowId: string;
  conversationId: string;
  agentId?: string | null;
  status?: string | null;
  /** Millisecond epoch — used by the client for ordering/diagnostics. */
  ts: number;
}

let sharedPublisher: Redis | null = null;

function getPublisher(): Redis {
  if (sharedPublisher) return sharedPublisher;
  const base = getRedisConnection();
  sharedPublisher = base.duplicate();
  sharedPublisher.on("error", (err) => {
    logger.error("Redis conversation-pubsub publisher error", { err });
  });
  return sharedPublisher;
}

/**
 * PUBLISH onto the app's Redis and return the subscriber count.
 *
 * Exported for the internal-events route, which is the server-side end of
 * the trigger.dev bridge — it must land here directly rather than
 * re-entering `publishRowEvent`, or a misconfigured `RUNNING_IN_TRIGGER`
 * on the webapp would have the route POST to itself in a loop.
 *
 * Throws on Redis failure; `publishRowEvent` is the layer that swallows.
 */
export async function publishRowEventToRedis(
  event: ConversationRowEvent,
): Promise<number> {
  const pub = getPublisher();
  return await pub.publish(
    `${CHANNEL_PREFIX}${event.conversationId}`,
    JSON.stringify(event),
  );
}

/**
 * Hand the envelope to the webapp over HTTP so it can publish onto the
 * Redis the SSE subscribers are actually on. Returns the receiver count
 * the webapp reports back, or null when it didn't report one.
 */
async function publishRowEventOverHttp(
  event: ConversationRowEvent,
): Promise<number | null> {
  const secret = env.INTERNAL_EVENTS_SECRET;
  if (!secret) {
    // Loud on purpose. The pre-bridge failure mode was a silent no-op
    // that only showed up as a stuck spinner in the UI — a missing
    // secret should name itself in the worker logs instead.
    logger.error(
      "conversation-pubsub: INTERNAL_EVENTS_SECRET unset in trigger runtime — row event dropped",
      { conversationId: event.conversationId, rowId: event.rowId },
    );
    return null;
  }

  const url = `${env.APP_ORIGIN.replace(/\/+$/, "")}${INTERNAL_EVENTS_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(HTTP_PUBLISH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `conversation-events responded ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json().catch(() => null)) as {
    receiverCount?: unknown;
  } | null;
  return typeof body?.receiverCount === "number" ? body.receiverCount : null;
}

/**
 * Fire an envelope onto `conv:{conversationId}`. Fire-and-forget —
 * failures are logged but never surfaced to callers, so a publish outage
 * can never break a DB write. Callers should invoke AFTER the write
 * commits (so subscribers who refetch the row see it).
 *
 * Transport is chosen per runtime — see the module header.
 */
export async function publishRowEvent(
  event: ConversationRowEvent,
): Promise<void> {
  const viaHttp = isRunningInTrigger();
  try {
    const receiverCount = viaHttp
      ? await publishRowEventOverHttp(event)
      : await publishRowEventToRedis(event);
    // Log the receiver count — Redis PUBLISH returns the number of
    // subscribers that got the message, and the bridge route passes that
    // number back through. Zero = nobody was listening (client not
    // subscribed yet, cross-process env mismatch, etc). This is the
    // single clearest signal for "the pubsub isn't wired right."
    logger.info("conversation-pubsub publish", {
      transport: viaHttp ? "http" : "redis",
      conversationId: event.conversationId,
      rowId: event.rowId,
      status: event.status,
      receiverCount,
    });
  } catch (err) {
    logger.warn("conversation-pubsub publish failed", {
      err,
      transport: viaHttp ? "http" : "redis",
      conversationId: event.conversationId,
      rowId: event.rowId,
    });
  }
}

/**
 * Open a subscriber-per-connection to `conv:{conversationId}` and invoke
 * `onEvent` for each envelope. Returns an async disposer the caller must
 * invoke when the connection closes — it unsubscribes and closes the
 * dedicated Redis client. Missing this cleanup leaks connections.
 */
export async function subscribeToConversation(
  conversationId: string,
  onEvent: (event: ConversationRowEvent) => void,
): Promise<() => Promise<void>> {
  const base = getRedisConnection();
  const sub = base.duplicate();
  const channel = `${CHANNEL_PREFIX}${conversationId}`;

  sub.on("error", (err) => {
    logger.warn("Redis conversation-pubsub subscriber error", {
      err,
      channel,
    });
  });

  sub.on("message", (chan, payload) => {
    if (chan !== channel) return;
    try {
      const parsed = JSON.parse(payload) as ConversationRowEvent;
      onEvent(parsed);
    } catch (err) {
      logger.warn("conversation-pubsub payload parse failed", { err, payload });
    }
  });

  await sub.subscribe(channel);

  return async () => {
    try {
      await sub.unsubscribe(channel);
    } catch {
      /* ignore — we're tearing down anyway */
    }
    try {
      await sub.quit();
    } catch {
      /* ignore */
    }
  };
}
