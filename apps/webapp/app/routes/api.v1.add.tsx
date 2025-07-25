import { json } from "@remix-run/node";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";
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
    const response = addToQueue(body, authentication.userId);
    return json({ ...response });
  },
);

export { action, loader };
