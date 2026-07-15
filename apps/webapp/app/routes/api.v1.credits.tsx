import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getUsageSummary } from "~/services/billing.server";
import { isBillingEnabled } from "~/config/billing.server";
import { isWorkspaceBYOK } from "~/services/byok.server";

/**
 * GET /api/v1/credits
 *   → { available, monthly, billingEnabled, byok }
 *
 * Lightweight credit-balance probe for the CLI (and any other headless
 * caller). Mirrors what the webapp derives from `root.tsx`'s loader —
 * `usageSummary` plus BYOK / billing flags — so a client can decide whether
 * it should block a new chat before hitting the `no_credits` 402 from
 * `/api/v1/conversation`.
 *
 * When `billingEnabled === false` OR `byok === true`, the client should
 * treat the workspace as always having credits.
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const workspaceId = authentication.workspaceId as string | undefined;
    if (!workspaceId) {
      return json({ error: "No workspace found" }, { status: 404 });
    }

    const [summary, byok] = await Promise.all([
      getUsageSummary(workspaceId, authentication.userId),
      isWorkspaceBYOK(workspaceId),
    ]);

    return json({
      available: summary?.credits.available ?? 0,
      monthly: summary?.credits.monthly ?? 0,
      billingEnabled: isBillingEnabled(),
      byok,
    });
  },
);

export { loader };
