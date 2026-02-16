import { json } from "@remix-run/node";
import { z } from "zod";
import { getPendingIngestionsForSession } from "~/services/ingestionLogs.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { getDocumentForSession } from "~/services/document.server";

// Schema for space ID parameter
const SessionParamsSchema = z.object({
  sessionId: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: SessionParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ params, authentication }) => {
    const document = await getDocumentForSession(
      params.sessionId,
      authentication.workspaceId as string,
    );

    const pendingIngestions = await getPendingIngestionsForSession(
      params.sessionId,
    );
    const pendingIngestionContent = pendingIngestions
      .map((pi) => (pi.data as any).episodeBody)
      .join("-----\n");

    return json({
      title: document?.title || null,
      content: document?.content || null,
      createdAt: document?.createdAt || null,
      updatedAt: document?.updatedAt || null,
      pendingContent: pendingIngestionContent || null,
      context: `${document?.content || ""}\n\n---------------------------\n\n${pendingIngestionContent}`,
    });
  },
);

export { loader };
