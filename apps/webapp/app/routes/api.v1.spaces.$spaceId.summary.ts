import { z } from "zod";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { json } from "@remix-run/node";
import { apiCors } from "~/utils/apiCors";
import { triggerSpaceSummary } from "~/trigger/spaces/space-summary";
import { SpaceService } from "~/services/space.server";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType, type DocumentNode } from "@core/types";
import * as crypto from "crypto";
import { saveDocument } from "~/services/graphModels/document";
import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";

const spaceService = new SpaceService();

// Schema for space ID parameter
const SpaceParamsSchema = z.object({
  spaceId: z.string(),
});

const { action } = createHybridActionApiRoute(
  {
    params: SpaceParamsSchema,
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ authentication, params, request }) => {
    const userId = authentication.userId;
    const { spaceId } = params;

    if (request.method === "PUT") {
      try {
        // Get the markdown content from request body
        const markdownContent = await request.text();

        if (!markdownContent || markdownContent.trim().length === 0) {
          return json(
            { error: "Empty summary content provided" },
            { status: 400 },
          );
        }

        // Get space details
        const space = await spaceService.getSpace(spaceId, userId);
        if (!space) {
          return json({ error: "Space not found" }, { status: 404 });
        }

        // Create updated summary document
        const documentUuid = await createUpdatedSummaryDocument(
          spaceId,
          userId,
          space.name,
          markdownContent,
        );

        // Queue document for ingestion
        await queueSummaryDocumentIngestion(
          documentUuid,
          spaceId,
          userId,
          markdownContent,
        );

        logger.info(
          `Updated space summary document ${documentUuid} for space ${spaceId}`,
        );

        return json({
          success: true,
          summary: {
            documentId: documentUuid,
            spaceId,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        logger.error(
          `Error updating space summary for ${spaceId}:`,
          error as Record<string, unknown>,
        );
        return json(
          { error: "Failed to update space summary" },
          { status: 500 },
        );
      }
    }

    if (request.method === "POST") {
      try {
        // Get space details first
        const space = await spaceService.getSpace(spaceId, userId);
        if (!space) {
          return json({ error: "Space not found" }, { status: 404 });
        }

        // Get workspace for user
        const user = await prisma.user.findFirst({
          where: { id: userId },
          include: { Workspace: true },
        });

        if (!user?.Workspace?.id) {
          return json({ error: "Workspace not found" }, { status: 400 });
        }

        // Trigger space summary generation using existing infrastructure
        const result = await triggerSpaceSummary({
          userId,
          spaceId,
          triggerSource: "manual",
        });

        return json({
          success: true,
          summary: {
            taskId: result.id,
            spaceId,
            triggeredAt: new Date().toISOString(),
            status: "processing",
          },
        });
      } catch (error) {
        logger.error(
          `Error generating space summary for ${spaceId}:`,
          error as Record<string, unknown>,
        );
        return json(
          { error: "Failed to generate space summary" },
          { status: 500 },
        );
      }
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  },
);

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    params: SpaceParamsSchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, request, params }) => {
    if (request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    try {
      // Get space details
      const space = await spaceService.getSpace(
        params.spaceId,
        authentication.userId,
      );

      if (!space) {
        return json({ error: "Space not found" }, { status: 404 });
      }

      // Return current space summary information
      return json({
        space: {
          id: space.uuid,
          name: space.name,
          description: space.description,
          summary: space.summary,
          themes: space.themes,
        },
      });
    } catch (error) {
      logger.error(
        `Error fetching space summary for ${params.spaceId}:`,
        error as Record<string, unknown>,
      );
      return json({ error: "Failed to fetch space summary" }, { status: 500 });
    }
  },
);

/**
 * Create an updated summary document
 */
async function createUpdatedSummaryDocument(
  spaceId: string,
  userId: string,
  spaceName: string,
  markdownContent: string,
): Promise<string> {
  const documentUuid = crypto.randomUUID();
  const contentHash = crypto
    .createHash("sha256")
    .update(markdownContent)
    .digest("hex");

  const document: DocumentNode = {
    uuid: documentUuid,
    title: `${spaceName} - Space Summary (Updated)`,
    originalContent: markdownContent,
    metadata: {
      documentType: "space_summary",
      spaceId,
      spaceName,
      updatedAt: new Date().toISOString(),
      updateSource: "manual",
    },
    source: "space",
    userId,
    createdAt: new Date(),
    validAt: new Date(),
    totalChunks: 1,
    sessionId: spaceId,
    version: 1, // TODO: Implement proper versioning
    contentHash,
    previousVersionUuid: undefined, // TODO: Link to previous version
    chunkHashes: [contentHash],
  };

  await saveDocument(document);
  return documentUuid;
}

/**
 * Queue the updated summary document for ingestion
 */
async function queueSummaryDocumentIngestion(
  documentUuid: string,
  spaceId: string,
  userId: string,
  markdownContent: string,
): Promise<void> {
  const ingestBody = {
    episodeBody: markdownContent,
    referenceTime: new Date().toISOString(),
    metadata: {
      documentType: "space_summary",
      documentUuid,
      spaceId,
      updateSource: "manual",
    },
    source: "space",
    spaceId,
    sessionId: spaceId,
    type: EpisodeType.DOCUMENT,
  };

  await addToQueue(ingestBody, userId);

  logger.info(
    `Queued updated space summary document ${documentUuid} for ingestion`,
  );
}

export { action, loader };
