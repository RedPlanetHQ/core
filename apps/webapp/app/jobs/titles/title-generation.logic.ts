/**
 * Title Generation Logic
 *
 * Uses LLM to generate appropriate titles for episodes based on their content and type
 */

import { makeModelCall } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { EpisodeType } from "@core/types";

export interface TitleGenerationPayload {
  queueId: string;
  userId: string;
  workspaceId: string;
}

export interface TitleGenerationResult {
  success: boolean;
  title?: string;
  error?: string;
}

/**
 * Process title generation for an ingested episode
 */
export async function processTitleGeneration(
  payload: TitleGenerationPayload,
): Promise<TitleGenerationResult> {
  try {
    logger.info(`Processing title generation for queue ${payload.queueId}`);

    // Fetch the ingestion queue entry
    const ingestionQueue = await prisma.ingestionQueue.findUnique({
      where: { id: payload.queueId },
    });

    if (!ingestionQueue) {
      throw new Error(`Ingestion queue ${payload.queueId} not found`);
    }

    // Get episode body from the data field
    const data = ingestionQueue.data as any;
    const episodeBody = data?.episodeBody || "";
    const episodeType = ingestionQueue.type;
    const sessionId = ingestionQueue.sessionId;

    // Check if Document already has a generated title (source of truth)
    if (sessionId) {
      const document = await prisma.document.findUnique({
        where: {
          sessionId_workspaceId: {
            sessionId,
            workspaceId: ingestionQueue.workspaceId,
          },
        },
        select: { title: true },
      });

      if (document?.title && document.title !== "Untitled Document") {
        logger.info(
          `Title already exists for document ${sessionId}: "${document.title}"`,
        );
        return {
          success: true,
          title: document.title,
        };
      }
    }

    if (!episodeBody) {
      logger.warn(`No episode body found for queue ${payload.queueId}`);
      return { success: false, error: "No episode body found" };
    }

    let title = "";

    // Handle different types
    if (episodeType === EpisodeType.DOCUMENT) {
      // For documents, just pass the document content to get title
      title = await generateTitleFromContent(episodeBody, "document");
    } else if (episodeType === EpisodeType.CONVERSATION) {
      if (sessionId) {
        // For conversations with sessionId, fetch other episodes in the same session
        title = await generateTitleForConversationWithSession(
          episodeBody,
          sessionId,
          payload.queueId,
        );
      } else {
        // For conversations without sessionId, just use the episode body
        title = await generateTitleFromContent(episodeBody, "conversation");
      }
    }

    logger.info(`Generated title for queue ${payload.queueId}: "${title}"`);

    // Update the ingestion queue with the title
    try {
      await prisma.ingestionQueue.update({
        where: { id: payload.queueId },
        data: {
          title: title,
        },
      });
    } catch (error) {
      logger.warn(
        `Could not update ingestion queue ${payload.queueId} with title - may have been deleted`,
      );
    }

    // Update the Document table if there's a sessionId
    if (sessionId) {
      try {
        await prisma.document.update({
          where: {
            sessionId_workspaceId: {
              sessionId,
              workspaceId: ingestionQueue.workspaceId,
            },
          },
          data: { title },
        });
        logger.info(`Updated document ${sessionId} with title: "${title}"`);
      } catch (error: any) {
        logger.warn(`Failed to update document title:`, {
          error: error.message,
          sessionId,
          queueId: payload.queueId,
        });
      }
    }

    return {
      success: true,
      title,
    };
  } catch (error: any) {
    logger.error(`Error processing title generation:`, {
      error: error.message,
      queueId: payload.queueId,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate title from content (for documents or standalone conversations)
 */
async function generateTitleFromContent(
  content: string,
  type: "document" | "conversation",
): Promise<string> {
  const prompt = buildSimpleTitlePrompt(content, type);

  let responseText = "";
  await makeModelCall(
    false,
    [{ role: "user", content: prompt }],
    (text) => {
      responseText = text;
    },
    {
      temperature: 0.5,
    },
    "low",
    "title-generation",
  );

  // Clean up the response
  return responseText.trim().replace(/^["']|["']$/g, "");
}

/**
 * Generate title for conversation with session context
 */
async function generateTitleForConversationWithSession(
  currentContent: string,
  sessionId: string,
  currentQueueId: string,
): Promise<string> {
  // Fetch other episodes in the same session
  const sessionQueues = await prisma.ingestionQueue.findMany({
    where: {
      sessionId,
      id: {
        not: currentQueueId, // Exclude current queue
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      title: true,
      data: true,
    },
  });

  // Extract previous titles and contents
  const previousContext = sessionQueues
    .map((q) => {
      const data = q.data as any;
      const content = data?.episodeBody || "";
      return {
        title: q.title,
        content: content.substring(0, 300), // Limit to 300 chars
      };
    })
    .filter((c) => c.content); // Only include entries with content

  const prompt = buildSessionContextTitlePrompt(
    currentContent,
    previousContext,
  );

  let responseText = "";
  await makeModelCall(
    false,
    [{ role: "user", content: prompt }],
    (text) => {
      responseText = text;
    },
    {
      temperature: 0.5,
    },
    "low",
    "title-generation-session",
  );

  return responseText.trim().replace(/^["']|["']$/g, "");
}

/**
 * Build prompt for simple title generation
 */
function buildSimpleTitlePrompt(
  content: string,
  type: "document" | "conversation",
): string {
  const typeDescription =
    type === "document"
      ? "This is a document or article"
      : "This is a conversation or chat message";

  return `You are a title generation expert. Create a concise, descriptive title for the following content.

${typeDescription}.

## Content

${content.substring(0, 1500)}${content.length > 1500 ? "..." : ""}

## Task

Generate a clear, concise title (3-8 words) that captures the main topic or theme of this content.

**Guidelines**:
- Be specific and descriptive
- Use natural language (not just keywords)
- Keep it under 8 words
- Don't use quotes or special formatting
- For conversations, focus on the main topic being discussed

Return ONLY the title text, nothing else.`;
}

/**
 * Build prompt for session-context title generation
 */
function buildSessionContextTitlePrompt(
  currentContent: string,
  previousContext: Array<{ title: string | null; content: string }>,
): string {
  const previousSection =
    previousContext.length > 0
      ? `## Previous Messages in Session

${previousContext
  .map(
    (ctx, idx) => `### Message ${idx + 1}
${ctx.title ? `Previous title: "${ctx.title}"` : ""}
Content preview: ${ctx.content}
`,
  )
  .join("\n")}

`
      : "";

  return `You are a conversation title generation expert. Create a concise, descriptive title for a new message in an ongoing conversation session.

${previousSection}## Current Message

${currentContent.substring(0, 1500)}${currentContent.length > 1500 ? "..." : ""}

## Task

Generate a clear, concise title (3-8 words) for this current message that:
1. Captures the specific focus of THIS message
2. Takes into account the conversation context from previous messages
3. Helps distinguish this message from others in the session

**Guidelines**:
- Be specific to THIS message's content
- Reference the conversation flow if relevant (e.g., "Follow-up on...", "Clarification about...")
- Use natural language (not just keywords)
- Keep it under 8 words
- Don't use quotes or special formatting

Return ONLY the title text, nothing else.`;
}
