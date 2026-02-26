import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { runGatewayExplorer } from "~/services/agent/gateway";
import { callGatewayTool } from "../../websocket";
import { logger } from "~/services/logger.service";

const ExecuteGatewayBodySchema = z.union([
  // Full explorer: run sub-agent with intent
  z.object({
    mode: z.literal("explorer").optional(),
    intent: z.string(),
  }),
  // Direct tool call: proxy a specific tool call over websocket
  z.object({
    mode: z.literal("tool"),
    toolName: z.string(),
    params: z.record(z.unknown()),
  }),
]);

/**
 * POST /api/v1/gateways/:gatewayId/execute
 *
 * Two modes:
 * - explorer (default): Runs the full gateway sub-agent with an intent.
 *   Used when running the gateway from a Trigger job (full LLM loop + websocket).
 * - tool: Proxies a single tool call over websocket.
 *   Used by HttpOrchestratorTools when gateway explorer LLM runs in Trigger
 *   but needs to call individual gateway tools via server websocket.
 */
const { action } = createHybridActionApiRoute(
  {
    body: ExecuteGatewayBodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body, params }) => {
    const gatewayId = params.gatewayId as string;

    if (body.mode === "tool") {
      logger.info(`Gateway tool call: ${gatewayId}/${body.toolName}`);
      try {
        const result = await callGatewayTool(
          gatewayId,
          body.toolName,
          body.params as Record<string, unknown>,
          60000,
        );
        return json({ result });
      } catch (error: any) {
        logger.warn(`Gateway tool failed: ${gatewayId}/${body.toolName}`, { error });
        return json({ error: error.message ?? "Gateway tool failed" }, { status: 500 });
      }
    }

    // Default: explorer mode
    logger.info(`Gateway explore: ${gatewayId} — ${(body as any).intent}`);
    const { stream, gatewayConnected } = await runGatewayExplorer(
      gatewayId,
      (body as any).intent,
    );

    if (!gatewayConnected || !stream) {
      return json({ error: "Gateway not connected" }, { status: 404 });
    }

    const result = await stream.text;
    return json({ result: result ?? "" });
  },
);

export { action };
