/**
 * Town webhook emitter.
 *
 * Fires `memory.added` / `memory.updated` envelopes at the town-next webapp
 * after voice aspects are resolved for an episode (see graph-resolution).
 *
 * Wire contract — must match `packages/types/src/index.ts` in town-next:
 *
 *   {
 *     id: string,                       // ULID/UUID, dedupe key
 *     userId: string,                   // CORE user.id (town looks up by coreUserId)
 *     type: "memory.added" | "memory.updated",
 *     occurredAt: string,               // ISO timestamp
 *     version: 1,
 *     payload: {
 *       memoryUuid: string,             // sessionId
 *       summary: string,                // Document.content or ""
 *       topics: Topic[],                // only on memory.added
 *       topicsAdded: Topic[],           // only on memory.updated
 *       identityAspects: string[],
 *     }
 *   }
 *
 *   Topic = { id, name, count, similar: TopicSibling[] }
 *   TopicSibling = { id, name, count, score }
 *
 * Disabled when `TOWN_WEBHOOK_URL` is not set — no-op, no errors. Callers
 * should wrap us in a try/catch anyway so the rest of the pipeline keeps
 * moving if the town side is down or slow.
 */

import crypto from "crypto";

import { env } from "~/env.server";
import { logger } from "./logger.service";

export type TopicSibling = {
  id: string;
  name: string;
  count: number;
  score: number;
};

export type Topic = {
  id: string;
  name: string;
  count: number;
  similar: TopicSibling[];
};

export type TownMemoryAddedPayload = {
  memoryUuid: string;
  summary: string;
  topics: Topic[];
  identityAspects: string[];
};

export type TownMemoryUpdatedPayload = {
  memoryUuid: string;
  summary: string;
  topicsAdded: Topic[];
  identityAspects: string[];
};

export type TownEnvelope =
  | {
      id: string;
      userId: string;
      type: "memory.added";
      occurredAt: string;
      version: 1;
      payload: TownMemoryAddedPayload;
    }
  | {
      id: string;
      userId: string;
      type: "memory.updated";
      occurredAt: string;
      version: 1;
      payload: TownMemoryUpdatedPayload;
    };

/** Sign + POST one envelope. Returns true on 2xx, false on any other
 *  outcome — the caller chooses whether to retry. We don't throw; the
 *  emitter is treated as best-effort by design. */
export async function sendTownEvent(envelope: TownEnvelope): Promise<boolean> {
  const url = env.TOWN_WEBHOOK_URL;
  const secret = env.TOWN_WEBHOOK_SECRET;
  if (!url || !secret) {
    return false;
  }

  const body = JSON.stringify(envelope);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-town-signature": signature,
      },
      body,
    });
    if (!res.ok) {
      logger.warn(`[town-webhook] non-2xx response: ${res.status}`, {
        id: envelope.id,
        type: envelope.type,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn(`[town-webhook] fetch failed: ${err?.message ?? err}`, {
      id: envelope.id,
      type: envelope.type,
    });
    return false;
  }
}
