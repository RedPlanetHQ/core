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

const SearchParamsSchema = z.object({
  query: z.string().optional(),
});

const ActionBodySchema = z.object({
  action: z.string().min(1, "Action name is required"),
  parameters: z.record(z.any()).optional().default({}),
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
      return IntegrationLoader.getIntegrationAccountById(
        params.integrationAccountId,
        authentication.userId,
      );
    },
  },
  async ({ params, searchParams, authentication }) => {
    const { integrationAccountId } = params;
    const { query } = searchParams;

    const actions = await getIntegrationActions(
      integrationAccountId,
      query,
      authentication.userId,
    );

    return json({ actions });
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

    const result = await executeIntegrationAction(
      integrationAccountId,
      actionName,
      parameters,
      authentication.userId,
    );

    return json({ result });
  },
);

export { loader, action };
