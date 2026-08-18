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
 */

import type { Redis } from "ioredis";
import { getRedisConnection } from "~/bullmq/connection";
import { logger } from "~/services/logger.service";

const CHANNEL_PREFIX = "conv:";

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
 * Fire an envelope onto `conv:{conversationId}`. Fire-and-forget —
 * failures are logged but never surfaced to callers, so a publish outage
 * can never break a DB write. Callers should invoke AFTER the write
 * commits (so subscribers who refetch the row see it).
 */
export async function publishRowEvent(
  event: ConversationRowEvent,
): Promise<void> {
  try {
    const pub = getPublisher();
    const receiverCount = await pub.publish(
      `${CHANNEL_PREFIX}${event.conversationId}`,
      JSON.stringify(event),
    );
    // Log the receiver count — Redis PUBLISH returns the number of
    // subscribers that got the message. Zero = nobody was listening
    // (client not subscribed yet, cross-process env mismatch, etc). This
    // is the single clearest signal for "the pubsub isn't wired right."
    logger.info("conversation-pubsub publish", {
      conversationId: event.conversationId,
      rowId: event.rowId,
      status: event.status,
      receiverCount,
    });
  } catch (err) {
    logger.warn("conversation-pubsub publish failed", {
      err,
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
