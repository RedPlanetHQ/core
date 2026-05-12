import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { updateWidgetState } from "~/services/widgets/widget.server";

const ParamsSchema = z.object({
  id: z.string().min(1),
});

const BodySchema = z.object({
  /** Sparse map: `{ stateId: value }`. Only keys included are written. */
  state: z.record(z.string(), z.unknown()),
});

/**
 * POST /api/v1/widgets/:id/state
 *
 * Persists widget state (the `state[].persist: true` subset). Called by the
 * runtime via a debounced effect when state mutates. Idempotent — server
 * stores the latest snapshot so out-of-order writes converge to "last
 * write wins."
 */
const { action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: BodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, body, authentication }) => {
    const { workspaceId, userId } = authentication;
    if (!workspaceId || !userId) {
      return json({ error: "Unauthenticated" }, { status: 401 });
    }
    await updateWidgetState(
      params.id,
      workspaceId,
      userId,
      body.state as Record<string, unknown>,
    );
    return json({ ok: true });
  },
);

export { action };
