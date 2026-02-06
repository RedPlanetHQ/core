import { randomUUID } from "node:crypto";
import { EpisodeTypeEnum } from "@core/types";
import { addToQueue } from "~/lib/ingest.server";
import { logger } from "~/services/logger.service";
import { SearchService } from "~/services/search.server";
import { hasCredits } from "~/services/billing.server";
import { prisma } from "~/db.server";
import { LabelService } from "~/services/label.server";
import { getUserDocuments } from "~/services/ingestionLogs.server";
import { getDocument, getPersonaForUser } from "~/services/document.server";

const searchService = new SearchService();
const labelService = new LabelService();

/**
 * Handler for user_context
 */
export async function handleUserProfile(workspaceId: string) {
  try {
    const personaId = await getPersonaForUser(workspaceId);
    const personaDocument = await getDocument(personaId!, workspaceId);

    const personaContent = personaDocument?.content ?? null;

    return {
      content: [
        {
          type: "text",
          text: personaContent || "No profile information available",
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(`Error getting user context:`, error);
    return {
      content: [
        {
          type: "text",
          text: `Error getting user context: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for memory_ingest
 */
export async function handleMemoryIngest(args: any) {
  try {
    // Check if workspace has sufficient credits before processing
    const hasSufficientCredits = await hasCredits(
      args.workspaceId as string,
      args.userId as string,
      "addEpisode",
    );

    if (!hasSufficientCredits) {
      return {
        content: [
          {
            type: "text",
            text: `Error ingesting data: your credits have expired`,
          },
        ],
        isError: true,
      };
    }

    const labelIds =
      args.labelIds || (args.labelId ? [args.labelId] : undefined);

    const response = await addToQueue(
      {
        episodeBody: args.message,
        referenceTime: new Date().toISOString(),
        source: args.source,
        type: EpisodeTypeEnum.CONVERSATION,
        labelIds,
        sessionId: args.sessionId,
      },
      args.userId,
      args.workspaceId,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id: response.id,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error(`MCP memory ingest error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error ingesting data: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for memory_search
 */
export async function handleMemorySearch(args: any) {
  try {
    const labelIds =
      args.labelIds || (args.labelId ? [args.labelId] : undefined);

    const results = await searchService.search(
      args.query,
      args.userId,
      args.workspaceId,
      {
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        endTime: args.endTime ? new Date(args.endTime) : undefined,
        labelIds,
        sortBy: args.sortBy as "relevance" | "recency" | undefined,
      },
      args.source,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results),
        },
      ],
    };
  } catch (error) {
    logger.error(`MCP memory search error: ${error}`);
    return {
      content: [
        {
          type: "text",
          text: `Error searching memory: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for get_documents
 */
export async function handleGetDocuments(args: any) {
  try {
    const { workspaceId, limit = 50 } = args;

    const documents = await getUserDocuments(workspaceId, limit);

    // Return simplified document info for listing
    const simplifiedDocuments = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt.toISOString(),
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplifiedDocuments),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get documents error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting documents: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for get_document
 */
export async function handleGetDocument(args: any) {
  try {
    const { documentId, workspaceId } = args;

    if (!documentId) {
      throw new Error("documentId is required");
    }

    const document = await getDocument(documentId, workspaceId);

    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Return full document details
    const documentDetails = {
      id: document.id,
      title: document.title,
      content: document.content,
      source: document.source,
      createdAt: document.createdAt.toISOString(),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(documentDetails),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get document error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting document: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for get_labels
 */
export async function handleGetLabels(args: any) {
  try {
    const { workspaceId } = args;

    const labels = await labelService.getWorkspaceLabels(workspaceId);

    // Return simplified label info for listing
    const simplifiedLabels = labels.map((label) => ({
      id: label.id,
      name: label.name,
      description: label.description,
      color: label.color,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplifiedLabels),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get labels error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting labels: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handler for get_session_id
 */
export async function handleGetSessionId() {
  try {
    const sessionId = randomUUID();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ sessionId }),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get session id error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error generating session ID: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
