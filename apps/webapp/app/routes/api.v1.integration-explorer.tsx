import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { runIntegrationExplorer } from "~/services/agent/explorers/integration-explorer";
import { logger } from "~/services/logger.service";

const IntegrationExplorerBodySchema = z.object({
  query: z.string(),
  integrationsList: z.string(),
  mode: z.enum(["read", "write"]),
  timezone: z.string().optional(),
  source: z.string(),
});

/**
 * POST /api/v1/integration-explorer
 * Runs the integration explorer for a query and returns the final text result.
 * Used by HttpOrchestratorTools when orchestrator runs in async job context.
 */
const { action } = createHybridActionApiRoute(
  {
    body: IntegrationExplorerBodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const { query, integrationsList, mode, timezone, source } = body;
    const { userId } = authentication;

    logger.info(`Integration explorer: ${mode} — ${query}`);

    const { stream, hasIntegrations } = await runIntegrationExplorer(
      query,
      integrationsList,
      mode,
      timezone ?? "UTC",
      source,
      userId,
    );

    if (!hasIntegrations) {
      return json({ result: "No integrations connected" });
    }

    const result = await stream.text;

    return json({ result: result ?? "" });
  },
);

export { action };
