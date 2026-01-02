import { json } from "@remix-run/node";
import { z } from "zod";
import { getPendingIngestionsForSession } from "~/services/ingestionLogs.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { getDocument } from "~/services/document.server";

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
    const workspace = await getWorkspaceByUser(authentication.userId);

    const document = await getDocument(
      params.documentId,
      workspace?.id as string,
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
