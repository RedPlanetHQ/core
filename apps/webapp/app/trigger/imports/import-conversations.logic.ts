import { logger } from "~/services/logger.service";
import type { ParsedConversation, ParsedExchange } from "./parsers/claude";
import {
  parseClaudeExport,
  formatExchangeAsEpisode,
  validateClaudeExport,
} from "./parsers/claude";
import {
  parseOpenAIExport,
  validateOpenAIExport,
} from "./parsers/openai";
import { processTopicAnalysis } from "~/jobs/bert/topic-analysis.logic";
import { getEmbedding } from "~/lib/model.server";
import { saveEpisode } from "~/services/graphModels/episode";
import { EpisodicNode } from "@core/types";
import { runQuery } from "~/lib/neo4j.server";
import type { StorageSource } from "~/lib/storage.server";
import { loadFile } from "~/lib/storage.server";

export interface ImportConversationsPayload {
  userId: string;
  workspaceId: string;
  provider: "claude" | "openai";
  dryRun?: boolean;
  storageSource: StorageSource; // Changed from filePath to storageSource
}

export interface ImportConversationsResult {
  success: boolean;
  conversationsParsed: number;
  exchangesParsed: number;
  tempEpisodesCreated: number;
  themesIdentified: number;
  documentsCreated: number;
  tempEpisodesDeleted: number;
  errors: string[];
}

/**
 * Main import logic - uses BERT clustering with temp Episode nodes
 *
 * Flow:
 * 1. Load and parse conversations from JSON file
 * 2. Create bare Episode nodes in Neo4j (with embeddings, no ingestion)
 * 3. Run BERT topic clustering (Python script)
 * 4. Generate themed documents (reuses topic-analysis)
 * 5. Delete temp Episode nodes
 * 6. Keep generated documents
 */
export async function processConversationImport(
  payload: ImportConversationsPayload,
): Promise<ImportConversationsResult> {
  const { userId, workspaceId, provider, dryRun = false, storageSource } = payload;

  logger.info("[Import] Starting conversation import with BERT clustering", {
    userId,
    provider,
    storageSource,
    dryRun,
  });

  const result: ImportConversationsResult = {
    success: true,
    conversationsParsed: 0,
    exchangesParsed: 0,
    tempEpisodesCreated: 0,
    themesIdentified: 0,
    documentsCreated: 0,
    tempEpisodesDeleted: 0,
    errors: [],
  };

  try {
    // Step 1: Load conversations file from storage
    logger.info("[Import] Loading conversations file from storage", { storageSource });

    const fileContent = await loadFile(storageSource);
    const conversationsJson = JSON.parse(fileContent);

    logger.info("[Import] Conversations file loaded", {
      storageSource,
      fileSize: `${(fileContent.length / 1024 / 1024).toFixed(2)} MB`,
      conversationCount: Array.isArray(conversationsJson) ? conversationsJson.length : 0,
    });

    // Step 2: Parse conversations into exchanges
    let conversations: ParsedConversation[] = [];

    if (provider === "claude") {
      if (!validateClaudeExport(conversationsJson)) {
        throw new Error("Invalid Claude export format");
      }
      conversations = parseClaudeExport(conversationsJson);
    } else if (provider === "openai") {
      if (!validateOpenAIExport(conversationsJson)) {
        throw new Error("Invalid OpenAI/ChatGPT export format");
      }
      conversations = parseOpenAIExport(conversationsJson);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    result.conversationsParsed = conversations.length;

    // Flatten all exchanges from all conversations
    const allExchanges: ParsedExchange[] = conversations.flatMap((conv) => conv.exchanges);
    result.exchangesParsed = allExchanges.length;

    if (allExchanges.length === 0) {
      logger.warn("[Import] No exchanges to process");
      return result;
    }

    logger.info("[Import] Parsed conversations into exchanges", {
      conversations: conversations.length,
      exchanges: allExchanges.length,
    });

    // Step 3: Create bare Episode nodes in Neo4j (one per exchange, with embeddings)
    logger.info("[Import] Creating temp episode nodes for each exchange", {
      count: allExchanges.length,
    });

    if (!dryRun) {
      const tempEpisodes: EpisodicNode[] = allExchanges.map((exchange) => ({
        uuid: exchange.id,
        content: formatExchangeAsEpisode(exchange),
        originalContent: formatExchangeAsEpisode(exchange),
        validAt: exchange.timestamp,
        labelIds: [],
        userId,
        createdAt: exchange.timestamp,
        sessionId: exchange.sessionId,
        source: "import",
        metadata: {
          isTemporary: true as const,
          importConversationId: exchange.id,
          originalTitle: exchange.conversationTitle,
          importProvider: provider,
        },
      }));

      const createdUuids = await createTempEpisodeNodes(tempEpisodes);
      result.tempEpisodesCreated = createdUuids.length;

      logger.info("[Import] Temp episode nodes created", {
        count: result.tempEpisodesCreated,
      });
    } else {
      logger.info("[Import] [DRY RUN] Would create temp episode nodes", {
        count: allExchanges.length,
      });
      result.tempEpisodesCreated = allExchanges.length;
    }

    // Step 3: Run BERT topic clustering
    // This will:
    // - Call Python script to cluster temp episodes by embeddings
    // - Identify themes from clusters
    // - Generate documents for each theme
    // - Ingest documents
    logger.info("[Import] Running BERT topic clustering on temp episodes");

    if (!dryRun) {
      const topicAnalysisResult = await processTopicAnalysis({
        userId,
        workspaceId,
      });

      result.themesIdentified = topicAnalysisResult.documentSummaries?.length || 0;
      result.documentsCreated = topicAnalysisResult.documentSummaries?.length || 0;

      logger.info("[Import] BERT topic analysis completed", {
        themesIdentified: result.themesIdentified,
        documentsCreated: result.documentsCreated,
      });
    } else {
      logger.info("[Import] [DRY RUN] Would run BERT clustering and generate documents");
    }

    // Step 4: Delete temp Episode nodes
    logger.info("[Import] Cleaning up temp episode nodes");

    if (!dryRun) {
      const deletedCount = await deleteTempEpisodes(userId);
      result.tempEpisodesDeleted = deletedCount;

      logger.info("[Import] Temp episodes deleted", {
        deletedCount,
      });
    } else {
      logger.info("[Import] [DRY RUN] Would delete temp episode nodes");
    }

    logger.info("[Import] Conversation import completed successfully", { result });
    return result;
  } catch (error: any) {
    logger.error("[Import] Import failed", {
      error: error.message,
      stack: error.stack,
    });
    result.success = false;
    result.errors.push(error.message);

    // Attempt cleanup on failure
    if (!dryRun && result.tempEpisodesCreated > 0) {
      try {
        logger.warn("[Import] Attempting cleanup after failure");
        const deletedCount = await deleteTempEpisodes(userId);
        result.tempEpisodesDeleted = deletedCount;
        logger.info("[Import] Cleanup completed", { deletedCount });
      } catch (cleanupError: any) {
        logger.error("[Import] Cleanup failed", { error: cleanupError.message });
        result.errors.push(`Cleanup failed: ${cleanupError.message}`);
      }
    }

    return result;
  }
}


async function createTempEpisodeNodes(tempEpisodes: EpisodicNode[]) {
  const createdUuids = await Promise.all(
    tempEpisodes.map(async (episode) => {
      episode.contentEmbedding = await getEmbedding(episode.content);
      return saveEpisode(episode);
    })
  );

  return createdUuids;
}

/**
 * Delete temp episode nodes
 */
export async function deleteTempEpisodes(userId: string): Promise<number> {
  logger.info("[TempEpisodes] Deleting temp episodes", { userId });

  const query = `
    MATCH (e:Episode {userId: $userId})
    WHERE e.metadata IS NOT NULL
      AND e.metadata CONTAINS '"isTemporary":true'
    DETACH DELETE e
    RETURN count(e) as deletedCount
  `;

  try {
    const result = await runQuery(query, { userId });
    const deletedCount = result[0]?.get("deletedCount").toNumber() || 0;

    logger.info("[TempEpisodes] Temp episodes deleted", {
      deletedCount,
    });

    return deletedCount;
  } catch (error: any) {
    logger.error("[TempEpisodes] Failed to delete temp episodes", {
      error: error.message,
      stack: error.stack,
    });
    return 0;
  }
}