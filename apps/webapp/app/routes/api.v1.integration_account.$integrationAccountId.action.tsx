import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import {
  getIntegrationActions,
  executeIntegrationAction,
} from "~/utils/mcp/integration-operations";

const ParamsSchema = z.object({
  integrationAccountId: z.string().min(1, "Integration account ID is required"),
});

// Route-builder's outer catch turns any thrown Error into 500 "Internal Server
// Error", which strips the account-not-found message the orchestrator relies on
// to hint the model back toward a valid UUID. Throwing a `Response` bypasses
// that catch and preserves the message.
function notFoundResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

const SearchParamsSchema = z.object({
  query: z.string().optional(),
});

const ActionBodySchema = z.object({
  action: z.string().min(1, "Action name is required"),
  parameters: z.record(z.string(), z.any()).optional().default({}),
  source: z.string().max(128).optional(),
});

/**
 * GET /api/v1/integration_account/:integrationAccountId/action
 * - No query param: returns all tools for this integration account
 * - ?query=<string>: uses LLM to filter relevant tools
 */
const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    searchParams: SearchParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async (params, authentication) => {
      try {
        return await IntegrationLoader.getIntegrationAccountById(
          params.integrationAccountId,
          authentication.userId,
        );
      } catch (error) {
        throw notFoundResponse(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  },
  async ({ params, searchParams, authentication }) => {
    const { integrationAccountId } = params;
    const { query } = searchParams;

    try {
      const actions = await getIntegrationActions(
        integrationAccountId,
        query,
        authentication.userId,
      );
      return json({ actions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found or not active|Integration account .* not found/i.test(message)) {
        throw notFoundResponse(message);
      }
      throw error;
    }
  },
);

/**
 * POST /api/v1/integration_account/:integrationAccountId/action
 * Body: { action: string, parameters?: object }
 * Executes the specified action on the integration account
 */
const { action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: ActionBodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, body, authentication }) => {
    const { integrationAccountId } = params;
    const { action: actionName, parameters } = body;
    
    const source =
      body.source ??
      (authentication.type === "OAUTH2" && authentication.oauth2
        ? `oauth:${authentication.oauth2.clientId}`
        : undefined);

    try {
      const result = await executeIntegrationAction(
        integrationAccountId,
        actionName,
        parameters,
        authentication.userId,
        source,
      );
      return json({ result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found or not active|Integration account .* not found/i.test(message)) {
        throw notFoundResponse(message);
      }
      throw error;
    }
  },
);

export { loader, action };
