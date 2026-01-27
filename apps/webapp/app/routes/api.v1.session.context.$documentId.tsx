import { json } from "@remix-run/node";
import { z } from "zod";
import { getPendingIngestionsForSession } from "~/services/ingestionLogs.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

import { getDocumentForSession } from "~/services/document.server";

// Schema for space ID parameter
const DocumentParamsSchema = z.object({
  documentId: z.string(),
});

export const LogUpdateBody = z.object({
  labels: z.array(z.string()).optional(),
  title: z.string().optional(),
});

export const ContentUpdateBody = z.object({
  content: z.string(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: DocumentParamsSchema,
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ params, authentication }) => {
    const document = await getDocumentForSession(
      params.documentId,
      authentication.workspaceId as string,
    );

    const pendingIngestions = await getPendingIngestionsForSession(
      params.documentId,
    );
    const pendingIngestionContent = pendingIngestions
      .map((pi) => (pi.data as any).episodeBody)
      .join("-----\n");

    return json({
      context: `${document.content}\n\n---------------------------\n\n${pendingIngestionContent}`,
    });
  },
);

export { loader };
