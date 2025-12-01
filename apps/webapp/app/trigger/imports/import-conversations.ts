import { task } from "@trigger.dev/sdk";
import { logger } from "~/services/logger.service";
import {
  processConversationImport,
  type ImportConversationsPayload,
  type ImportConversationsResult,
} from "./import-conversations.logic";

/**
 * Import conversations from external providers (Claude, OpenAI)
 *
 * This task:
 * 1. Parses conversation exports from providers
 * 2. Identifies main themes across conversations
 * 3. Generates summary documents for each theme
 * 4. Ingests documents into knowledge graph
 *
 * Usage:
 *   await importConversationsTask.trigger({
 *     userId: "user123",
 *     workspaceId: "workspace456",
 *     conversationsJson: [...], // Parsed JSON export
 *     provider: "claude"
 *   });
 *
 *   // Dry run to preview themes
 *   await importConversationsTask.trigger({
 *     userId: "user123",
 *     workspaceId: "workspace456",
 *     conversationsJson: [...],
 *     provider: "claude",
 *     dryRun: true
 *   });
 */
export const importConversationsTask = task({
  id: "import-conversations",
  machine: "large-2x", // Needs memory for LLM synthesis
  run: async (
    payload: ImportConversationsPayload,
  ): Promise<ImportConversationsResult> => {
    logger.info("[Import Task] Starting conversation import", {
      userId: payload.userId,
      provider: payload.provider,
      dryRun: payload.dryRun || false,
    });

    try {
      const result = await processConversationImport(payload);

      logger.info("[Import Task] Import completed", {
        userId: payload.userId,
        result,
      });

      return result;
    } catch (error: any) {
      logger.error("[Import Task] Import failed", {
        userId: payload.userId,
        error: error.message,
      });

      return {
        success: false,
        conversationsParsed: 0,
        exchangesParsed: 0,
        themesIdentified: 0,
        documentsCreated: 0,
        errors: [error.message],
        tempEpisodesCreated: 0,
        tempEpisodesDeleted: 0,
      };
    }
  },
});
