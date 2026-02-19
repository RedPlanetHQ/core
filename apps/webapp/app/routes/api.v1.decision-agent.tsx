import { json } from "@remix-run/node";
import { z } from "zod";

import { runCASEPipeline, type CASEPipelineInput } from "~/services/agent/decision-agent-pipeline";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";

/**
 * POST /api/v1/decision-agent
 *
 * Generic entry point for CASE. Accepts a pre-built trigger + context,
 * runs the decision agent, executes the plan, and returns the result.
 *
 * The caller is responsible for:
 * - Building the trigger and context
 * - Updating counts / scheduling after the call
 */
const DecisionAgentBody = z.object({
  trigger: z.any(),
  context: z.any(),
  userPersona: z.string().optional(),
  userData: z.object({
    userId: z.string(),
    email: z.string(),
    phoneNumber: z.string().optional(),
    workspaceId: z.string(),
  }),
  reminderText: z.string(),
  reminderId: z.string(),
  timezone: z.string(),
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: DecisionAgentBody,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body }) => {
    const result = await runCASEPipeline(body as CASEPipelineInput);
    return json(result);
  },
);

export { action, loader };
