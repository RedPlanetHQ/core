/**
 * `GET /api/v1/conversation/:conversationId/subscribe` — SSE feed of
 * ConversationHistory row upserts for a single conversation.
 *
 * Each server-side `upsertConversationHistory` publishes an envelope to
 * Redis on `conv:{conversationId}`; this endpoint subscribes on behalf
 * of one connected client and forwards envelopes as SSE `message`
 * events. Cleanup on client disconnect unsubscribes and closes the
 * dedicated Redis client — leaked subscribers would tie up connections.
 *
 * Auth: session cookie only for now (mirrors the rest of the webapp
 * routes served over the same origin). Ownership check is a
 * conversation lookup scoped by userId — 404 for anyone else's convo.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import {
  subscribeToConversation,
  type ConversationRowEvent,
} from "~/services/conversation-pubsub.server";
import { logger } from "~/services/logger.service";

const HEARTBEAT_MS = 15_000;

export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const conversationId = params.conversationId;
  if (!conversationId) {
    return new Response("missing conversationId", { status: 400 });
  }

  // Ownership check — a session cookie doesn't scope; the conversation
  // must belong to this user. Returning 404 (rather than 403) is
  // deliberate: we don't leak whether the id exists.
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id, deleted: null },
    select: { id: true },
  });
  if (!conv) {
    return new Response("not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let dispose: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ConversationRowEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch (err) {
          // Controller may have been closed under us if the client dropped
          // between the pubsub tick and the flush. Nothing to do.
          logger.warn("conversation-subscribe: enqueue after close", { err });
        }
      };

      try {
        dispose = await subscribeToConversation(conversationId, send);
      } catch (err) {
        logger.error("conversation-subscribe: subscribe failed", {
          err,
          conversationId,
        });
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        return;
      }

      // Initial keepalive so the client's EventSource fires `open`
      // immediately rather than sitting silent until the first row.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      // Periodic keepalive — proxies (nginx, cloudflare) kill idle
      // connections after ~30–60s otherwise.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* controller closed — cancel will run cleanup */
        }
      }, HEARTBEAT_MS);

      // Client disconnect (nav away, tab close). Ask the server to
      // tear down promptly rather than waiting for the next enqueue.
      request.signal.addEventListener("abort", () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    async cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (dispose) {
        await dispose();
        dispose = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Some proxies buffer SSE otherwise; this is the nginx-friendly hint.
      "X-Accel-Buffering": "no",
    },
  });
}
