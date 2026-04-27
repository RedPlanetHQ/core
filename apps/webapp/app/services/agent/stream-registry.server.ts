import { getRedisConnection } from "~/bullmq/connection";
import { logger } from "~/services/logger.service";

const STOP_CHANNEL = "conversation:stream:stop";

const controllers = new Map<string, AbortController>();
let subscriberInitialized = false;

function ensureSubscriber(): void {
  if (subscriberInitialized) return;
  subscriberInitialized = true;

  const subscriber = getRedisConnection().duplicate();
  subscriber.on("error", (err) => {
    logger.error("[stream-registry] subscriber error", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  subscriber.subscribe(STOP_CHANNEL).catch((err) => {
    logger.error("[stream-registry] failed to subscribe to stop channel", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  subscriber.on("message", (channel, raw) => {
    if (channel !== STOP_CHANNEL) return;
    try {
      const { streamId, reason } = JSON.parse(raw) as {
        streamId: string;
        reason?: string;
      };
      abortLocal(streamId, reason ?? "remote_stop");
    } catch (err) {
      logger.warn("[stream-registry] invalid stop payload", {
        raw,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function abortLocal(streamId: string, reason: string): boolean {
  const ctrl = controllers.get(streamId);
  if (!ctrl) return false;
  if (!ctrl.signal.aborted) {
    ctrl.abort(reason);
  }
  return true;
}

export function registerStream(
  streamId: string,
  controller: AbortController,
): void {
  ensureSubscriber();
  controllers.set(streamId, controller);
}

export function unregisterStream(streamId: string): void {
  controllers.delete(streamId);
}

/**
 * Abort a stream by id. Aborts locally if this process owns it, then
 * publishes on the stop channel so other instances can abort their copy.
 */
export async function stopStream(
  streamId: string,
  reason = "user_stopped",
): Promise<void> {
  abortLocal(streamId, reason);
  try {
    await getRedisConnection().publish(
      STOP_CHANNEL,
      JSON.stringify({ streamId, reason }),
    );
  } catch (err) {
    logger.warn("[stream-registry] failed to publish stop", {
      streamId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
