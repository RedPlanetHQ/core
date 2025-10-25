import { z } from "zod";
import { json } from "@remix-run/node";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { enqueueDeepSearch } from "~/lib/queue-adapter.server";
import { runs } from "@trigger.dev/sdk";
import { trackFeatureUsage } from "~/services/telemetry.server";

const DeepSearchBodySchema = z.object({
  content: z.string().min(1, "Content is required"),
  intentOverride: z.string().optional(),
  stream: z.boolean().default(false),
  metadata: z
    .object({
      source: z.enum(["chrome", "obsidian", "mcp"]).optional(),
      url: z.string().optional(),
      pageTitle: z.string().optional(),
    })
    .optional(),
});

const { action, loader } = createActionApiRoute(
  {
    body: DeepSearchBodySchema,
    method: "POST",
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    // Track deep search
    trackFeatureUsage("deep_search_performed", authentication.userId).catch(console.error);

    let trigger;
    if (!body.stream) {
      trigger = await enqueueDeepSearch({
        content: body.content,
        userId: authentication.userId,
        stream: body.stream,
        intentOverride: body.intentOverride,
        metadata: body.metadata,
      });

      return json(trigger);
    } else {
      const runHandler = await enqueueDeepSearch({
        content: body.content,
        userId: authentication.userId,
        stream: body.stream,
        intentOverride: body.intentOverride,
        metadata: body.metadata,
      });

      for await (const run of runs.subscribeToRun(runHandler.id)) {
        if (run.status === "COMPLETED") {
          return json(run.output);
        } else if (run.status === "FAILED") {
          return json(run.error);
        }
      }

      return json({ error: "Run failed" });
    }
  },
);

export { action, loader };
