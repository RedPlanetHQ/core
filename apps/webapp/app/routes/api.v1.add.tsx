import { json } from "@remix-run/node";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";
import { logger } from "~/services/logger.service";
import { IngestBodyRequest } from "~/trigger/ingest/ingest";

const { action, loader } = createHybridActionApiRoute(
  {
    body: IngestBodyRequest,
    allowJWT: true,
    authorization: {
      action: "ingest",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      const response = await addToQueue(
        body,
        authentication.userId,
        authentication?.workspaceId as string,
      );
      return json({ success: true, id: response.id });
    } catch (error) {
      logger.error("api.v1.add addToQueue failed", {
        userId: authentication.userId,
        workspaceId: authentication?.workspaceId,
        source: (body as { source?: unknown })?.source,
        episodeBodyKeys: body ? Object.keys(body as Record<string, unknown>) : [],
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  },
);

export { action, loader };
