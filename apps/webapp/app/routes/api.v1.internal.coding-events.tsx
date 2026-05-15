import { json } from "@remix-run/node";
import { z } from "zod";

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { enqueueCodingDescriptionUpdate } from "~/lib/queue-adapter.server";

const EventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn_ended"),
    baseUrl: z.string().min(1),
    sessionId: z.string().min(1),
    at: z.string().optional(),
  }),
]);

/**
 * POST /api/v1/internal/coding-events
 *
 * Inbound channel for gateways to push coding-session events. Authenticated
 * with the user's API key (the same `auth.apiKey` the CLI stores in
 * `config.auth`); the gateway identifies itself by `baseUrl` rather than
 * by its webapp-side ID, since the CLI doesn't know its own remote ID.
 *
 * Event today: `turn_ended` — the gateway saw a session transition from
 * "working" (assistant still typing) to "idle" (assistant turn complete).
 * The webapp enqueues a description-update job in response.
 */
const { action } = createHybridActionApiRoute(
  {
    body: EventSchema,
    allowJWT: false,
    corsStrategy: "none",
  },
  async ({ body, authentication }) => {
    const workspaceId = authentication.workspaceId as string;

    const normalizedBaseUrl = body.baseUrl.replace(/\/+$/, "");
    const gateway = await prisma.gateway.findFirst({
      where: {
        workspaceId,
        baseUrl: normalizedBaseUrl,
      },
      select: { id: true },
    });
    if (!gateway) {
      // No matching gateway — accept silently so the CLI doesn't retry.
      return json({ ok: true, ignored: "no_gateway" });
    }

    if (body.kind !== "turn_ended") {
      return json({ ok: true });
    }

    const session = await prisma.codingSession.findFirst({
      where: {
        gatewayId: gateway.id,
        externalSessionId: body.sessionId,
      },
      select: { id: true, workspaceId: true, taskId: true },
    });
    if (!session) {
      return json({ ok: true, ignored: "no_coding_session" });
    }
    if (!session.taskId) {
      return json({ ok: true, ignored: "no_task" });
    }

    try {
      await enqueueCodingDescriptionUpdate({
        codingSessionId: session.id,
        workspaceId: session.workspaceId,
      });
    } catch (err) {
      logger.error("Failed to enqueue coding description update", {
        baseUrl: normalizedBaseUrl,
        sessionId: body.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return json({ error: "Enqueue failed" }, { status: 500 });
    }

    return json({ ok: true });
  },
);

export { action };
