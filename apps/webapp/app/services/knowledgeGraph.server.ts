import {
  type AddEpisodeParams,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
  EpisodeTypeEnum,
  EpisodeType,
  type AddEpisodeResult,
  EntityTypes,
} from "@core/types";
import { logger } from "./logger.service";
import crypto from "crypto";
import {
  extractCombined,
  CombinedExtractionSchema,
} from "./prompts/combined-extraction";
import {
  getEpisode,
  saveEpisode,
  searchEpisodesByEmbedding,
} from "./graphModels/episode";
import {
  saveTriple,
  searchStatementsByEmbedding,
} from "./graphModels/statement";
import {
  getEmbedding,
  makeModelCall,
  makeStructuredModelCall,
} from "~/lib/model.server";
import { normalizePrompt, normalizeDocumentPrompt } from "./prompts";
import { type EpisodeEmbedding, type PrismaClient } from "@prisma/client";
import {
  storeEpisodeEmbedding,
  batchStoreEntityEmbeddings,
  batchStoreStatementEmbeddings,
  getRecentEpisodes,
} from "./vectorStorage.server";
import { type ModelMessage } from "ai";

// Default number of previous episodes to retrieve for context
const DEFAULT_EPISODE_WINDOW = 5;

export class KnowledgeGraphService {
  async getEmbedding(text: string) {
    return getEmbedding(text);
  }
  /**
   * Process an episode and update the knowledge graph.
   *
   * This method extracts information from the episode, creates nodes and statements,
   * and updates the HelixDB database according to the reified + temporal approach.
   */
  async addEpisode(
    params: AddEpisodeParams,
    prisma: PrismaClient,
  ): Promise<AddEpisodeResult> {
    const startTime = Date.now();
    const now = new Date();

    // Track token usage by complexity
    const tokenMetrics = {
      high: { input: 0, output: 0, total: 0, cached: 0 },
      low: { input: 0, output: 0, total: 0, cached: 0 },
    };

    try {
      // Step 1: Get or create episode
      let episode: EpisodicNode;

      if (params.episodeUuid) {
        // Episode was already saved in preprocessing - retrieve it
        const existingEpisode = await getEpisode(params.episodeUuid, false);
        if (!existingEpisode) {
          throw new Error(`Episode ${params.episodeUuid} not found in graph`);
        }
        episode = existingEpisode;
        logger.log(
          `Retrieved existing episode ${params.episodeUuid} from preprocessing`,
        );
      } else {
        // Backwards compatibility: create and save episode if not from preprocessing
        episode = {
          uuid: crypto.randomUUID(),
          content: params.episodeBody,
          originalContent: params.episodeBody,
          contentEmbedding: [],
          source: params.source,
          metadata: params.metadata || {},
          createdAt: now,
          validAt: new Date(params.referenceTime),
          labelIds: params.labelIds || [],
          userId: params.userId,
          sessionId: params.sessionId,
          queueId: params.queueId,
          type: params.type,
          chunkIndex: params.chunkIndex,
          totalChunks: params.totalChunks,
          version: params.version,
          contentHash: params.contentHash,
          previousVersionSessionId: params.previousVersionSessionId,
          chunkHashes: params.chunkHashes,
        };

        await saveEpisode(episode);
        logger.log(`Created and saved new episode ${episode.uuid}`);
      }

      // Step 2: Context Retrieval - Get episodes for context
      let previousEpisodes: EpisodeEmbedding[] = [];
      let sessionContext: string | undefined;
      let previousVersionContent: string | undefined;

      if (params.type === EpisodeTypeEnum.DOCUMENT) {
        // For documents, we need TWO types of context:
        // 1. Current version session context (already ingested chunks from current version)
        // 2. Previous version context via EMBEDDING SEARCH

        // Get current version session context (earlier chunks already ingested)
        previousEpisodes = await getRecentEpisodes(
          params.userId,
          DEFAULT_EPISODE_WINDOW,
          params.sessionId,
          [episode.uuid],
          params.version,
        );

        if (previousEpisodes.length > 0) {
          sessionContext = previousEpisodes
            .map(
              (ep, i) =>
                `Chunk ${ep.chunkIndex} (${ep.createdAt.toISOString()}): ${ep.content}`,
            )
            .join("\n\n");
        }

        // Get previous version episodes via embedding search
        if (params.version && params.version > 1) {
          const previousVersion = params.version - 1;

          // Use the changes blob (fast-diff extracted content) as query
          const queryText = params.originalEpisodeBody;

          // Generate embedding for changes
          const changesEmbedding = await this.getEmbedding(queryText);

          // Search previous version episodes by semantic similarity
          const relatedPreviousChunks = await searchEpisodesByEmbedding({
            embedding: changesEmbedding,
            userId: params.userId,
            limit: 3, // Top 3 most related chunks
            excludeIds: [episode.uuid],
            sessionId: params.sessionId,
            version: previousVersion,
          });

          console.log("relatedPreviousChunks: ", relatedPreviousChunks.length);

          if (relatedPreviousChunks.length > 0) {
            // Concatenate related chunks as previous version context
            previousVersionContent = relatedPreviousChunks
              .map(
                (ep) =>
                  `[Chunk ${ep.chunkIndex}]\n${ep.originalContent || ep.content}`,
              )
              .join("\n\n");

            logger.info(
              `Embedding search found ${relatedPreviousChunks.length} related chunks from previous version`,
              {
                previousVersion,
                chunkIndices: relatedPreviousChunks.map((ep) => ep.chunkIndex),
              },
            );
          }
        }
      } else {
        // For conversations: get recent messages in same session
        previousEpisodes = await getRecentEpisodes(
          params.userId,
          DEFAULT_EPISODE_WINDOW,
          params.sessionId,
          [episode.uuid],
        );

        if (previousEpisodes.length > 0) {
          sessionContext = previousEpisodes
            .map(
              (ep, i) =>
                `Episode ${i + 1} (${ep.createdAt.toISOString()}): ${ep.content}`,
            )
            .join("\n\n");
        }
      }

      console.log("previousEpisodes: ", previousEpisodes);
      console.log("previousVersionContent: ", previousVersionContent);

      const normalizedEpisodeBody = await this.normalizeEpisodeBody(
        params.episodeBody,
        params.source,
        params.userId,
        prisma,
        tokenMetrics,
        new Date(params.referenceTime),
        sessionContext,
        params.type,
        previousVersionContent,
        params.userName,
      );

      const normalizedTime = Date.now();
      logger.log(`Normalized episode body in ${normalizedTime - startTime} ms`);

      if (normalizedEpisodeBody === "NOTHING_TO_REMEMBER") {
        logger.log("Nothing to remember");
        return {
          type: params.type || EpisodeType.CONVERSATION,
          episodeUuid: null,
          statementsCreated: 0,
          processingTimeMs: 0,
        };
      }

      // Step 3: Update episode with normalized content and embedding
      episode.content = normalizedEpisodeBody;

      // Save episode immediately to Neo4j
      await saveEpisode(episode);

      const episodeEmbedding = await this.getEmbedding(normalizedEpisodeBody);

      // Store episode embedding in vector provider
      await storeEpisodeEmbedding(
        episode.uuid,
        normalizedEpisodeBody,
        episodeEmbedding,
        params.userId,
        params.queueId,
        params.labelIds || [],
        params.sessionId,
        params.version,
        params.chunkIndex,
      );

      const episodeUpdatedTime = Date.now();
      logger.log(
        `Updated episode with normalized content and stored embedding in ${episodeUpdatedTime - normalizedTime} ms`,
      );

      // Step 3 & 4: Combined Entity and Statement Extraction (single LLM call)
      const extractedStatements =
        await this.extractCombinedEntitiesAndStatements(
          episode,
          previousEpisodes,
          tokenMetrics,
          params.userName,
        );
      const extractedStatementsTime = Date.now();
      logger.log(
        `Combined extraction completed in ${extractedStatementsTime - episodeUpdatedTime} ms`,
      );
      // Save triples without resolution
      for (const triple of extractedStatements) {
        await saveTriple(triple);
      }

      // Generate and store embeddings in batch (more efficient than per-triple)
      if (extractedStatements.length > 0) {
        // Collect unique entities and facts

        const uniqueEntities = new Map<string, EntityNode>();
        const facts: Array<{ uuid: string; text: string }> = [];

        for (const triple of extractedStatements) {
          // Collect statement facts
          facts.push({
            uuid: triple.statement.uuid,
            text: triple.statement.fact,
          });

          // Collect unique entities (subject, predicate, object)
          if (!uniqueEntities.has(triple.subject.uuid)) {
            uniqueEntities.set(triple.subject.uuid, triple.subject);
          }
          if (!uniqueEntities.has(triple.predicate.uuid)) {
            uniqueEntities.set(triple.predicate.uuid, triple.predicate);
          }
          if (!uniqueEntities.has(triple.object.uuid)) {
            uniqueEntities.set(triple.object.uuid, triple.object);
          }
        }

        const embeddingTime = Date.now();
        // Batch generate embeddings
        const entities = Array.from(uniqueEntities.values());
        const [factEmbeddings, entityEmbeddings] = await Promise.all([
          Promise.all(facts.map((f) => this.getEmbedding(f.text))),
          Promise.all(entities.map((e) => this.getEmbedding(e.name))),
        ]);
        const embeddingEndTime = Date.now();
        logger.log(
          `Generated embeddings in ${embeddingEndTime - embeddingTime} ms`,
        );

        // Batch store statement embeddings (single database call)
        await batchStoreStatementEmbeddings(
          facts.map((fact, index) => ({
            uuid: fact.uuid,
            fact: fact.text,
            embedding: factEmbeddings[index],
            userId: params.userId,
          })),
        );
        const embeddingStoreEndTime = Date.now();
        logger.log(
          `Stored embeddings in ${embeddingStoreEndTime - embeddingEndTime} ms`,
        );

        // Batch store entity embeddings (single database call)
        await batchStoreEntityEmbeddings(
          entities.map((entity, index) => ({
            uuid: entity.uuid,
            name: entity.name,
            embedding: entityEmbeddings[index],
            userId: params.userId,
          })),
        );
        const embeddingEntityStoreEndTime = Date.now();
        logger.log(
          `Stored entity embeddings in ${embeddingEntityStoreEndTime - embeddingEndTime} ms`,
        );
      }

      const saveTriplesTime = Date.now();
      logger.log(
        `Saved ${extractedStatements.length} triples and stored embeddings in ${saveTriplesTime - extractedStatementsTime} ms`,
      );

      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;
      logger.log(
        `Processing time (without resolution): ${processingTimeMs} ms`,
      );

      return {
        type: params.type || EpisodeType.CONVERSATION,
        episodeUuid: episode.uuid,
        statementsCreated: extractedStatements.length,
        processingTimeMs,
        tokenUsage: tokenMetrics,
        totalChunks: params.totalChunks,
        currentChunk: params.chunkIndex ? params.chunkIndex + 1 : 1,
      };
    } catch (error) {
      console.error("Error in addEpisode:", error);
      throw error;
    }
  }

  /**
   * Combined extraction: Extract entities and statements in a single LLM call
   * This ensures only entities that form meaningful user-specific statements are extracted
   */
  private async extractCombinedEntitiesAndStatements(
    episode: EpisodicNode,
    previousEpisodes: EpisodeEmbedding[],
    tokenMetrics: {
      high: { input: number; output: number; total: number; cached: number };
      low: { input: number; output: number; total: number; cached: number };
    },
    userName?: string,
  ): Promise<Triple[]> {
    const context = {
      episodeContent: episode.content,
      previousEpisodes: previousEpisodes.map((ep) => ({
        content: ep.content,
        createdAt: ep.createdAt.toISOString(),
      })),
      referenceTime: episode.validAt.toISOString(),
      userName,
    };

    const messages = extractCombined(context);

    // Combined extraction uses HIGH complexity
    const { object: response, usage } = await makeStructuredModelCall(
      CombinedExtractionSchema,
      messages as ModelMessage[],
      "high",
      "combined-extraction",
    );

    // Track token usage
    if (usage) {
      tokenMetrics.high.input += usage.promptTokens as number;
      tokenMetrics.high.output += usage.completionTokens as number;
      tokenMetrics.high.total += usage.totalTokens as number;
      tokenMetrics.high.cached += (usage.cachedInputTokens as number) || 0;
    }

    const { entities: extractedEntities, statements: extractedStatements } =
      response;

    console.log(
      "Combined extraction - Statements:",
      extractedStatements.length,
    );

    // Convert extracted entities to EntityNode objects
    const entityMap = new Map<string, EntityNode>();
    for (const entity of extractedEntities) {
      const entityNode: EntityNode = {
        uuid: crypto.randomUUID(),
        name: entity.name,
        type: entity.type,
        attributes: entity.attributes || {}, // Use extracted attributes or empty object
        nameEmbedding: [],
        createdAt: new Date(),
        userId: episode.userId,
      };
      entityMap.set(entity.name.toLowerCase(), entityNode);
    }

    // Create predicate map for deduplication
    const predicateMap = new Map<string, EntityNode>();
    for (const stmt of extractedStatements) {
      const predicateName = stmt.predicate.toLowerCase();
      if (!predicateMap.has(predicateName)) {
        predicateMap.set(predicateName, {
          uuid: crypto.randomUUID(),
          name: stmt.predicate,
          type: "Predicate",
          attributes: {},
          nameEmbedding: null as any,
          createdAt: new Date(),
          userId: episode.userId,
        });
      }
    }

    // Convert statements to Triple objects
    const triples = extractedStatements.map((stmt) => {
      // Find subject - must be in extracted entities
      let subjectNode = entityMap.get(stmt.source.toLowerCase());

      // If subject not found, create it without a default type
      if (!subjectNode) {
        subjectNode = {
          uuid: crypto.randomUUID(),
          name: stmt.source,
          type: undefined,
          attributes: {},
          nameEmbedding: [],
          createdAt: new Date(),
          userId: episode.userId,
        };
        entityMap.set(stmt.source.toLowerCase(), subjectNode);
      }

      // Find object - can be entity or literal value
      let objectNode = entityMap.get(stmt.target.toLowerCase());

      // If object not found, create it without a default type
      if (!objectNode) {
        objectNode = {
          uuid: crypto.randomUUID(),
          name: stmt.target,
          type: undefined,
          attributes: {},
          nameEmbedding: [],
          createdAt: new Date(),
          userId: episode.userId,
        };
        entityMap.set(stmt.target.toLowerCase(), objectNode);
      }

      const predicateNode = predicateMap.get(stmt.predicate.toLowerCase())!;

      // IMPORTANT: validAt vs event_date distinction
      // - validAt: When the FACT became true (when it entered the knowledge base)
      // - event_date: When the EVENT actually occurs/occurred (past, present, or future)
      const validAtDate = episode.validAt; // Always use episode timestamp

      // Build attributes object
      const attributes: Record<string, any> = {};
      if (stmt.event_date) attributes.event_date = stmt.event_date;

      const statement: StatementNode = {
        uuid: crypto.randomUUID(),
        fact: stmt.fact,
        factEmbedding: [],
        createdAt: new Date(),
        validAt: validAtDate,
        invalidAt: null,
        attributes,
        aspect: stmt.aspect || null,
        userId: episode.userId,
      };

      return {
        statement,
        subject: subjectNode,
        predicate: predicateNode,
        object: objectNode,
        provenance: episode,
      };
    });

    return triples as Triple[];
  }

  /**
   * Normalize an episode by extracting entities and creating nodes and statements
   */
  private async normalizeEpisodeBody(
    episodeBody: string,
    source: string,
    userId: string,
    prisma: PrismaClient,
    tokenMetrics: {
      high: { input: number; output: number; total: number; cached: number };
      low: { input: number; output: number; total: number; cached: number };
    },
    episodeTimestamp?: Date,
    sessionContext?: string,
    contentType?: EpisodeType,
    previousVersionContent?: string,
    userName?: string,
  ) {
    // Format entity types for prompt
    const entityTypes = EntityTypes.filter((t) => t !== "Predicate")
      .map((t) => `- ${t}`)
      .join("\n");

    // Get related memories
    const relatedMemories = await this.getRelatedMemories(episodeBody, userId);

    // Fetch ingestion rules for this source
    const ingestionRules = await this.getIngestionRulesForSource(
      source,
      userId,
      prisma,
    );

    const context = {
      episodeContent: episodeBody,
      entityTypes,
      source,
      relatedMemories,
      ingestionRules,
      episodeTimestamp:
        episodeTimestamp?.toISOString() || new Date().toISOString(),
      sessionContext,
      previousVersionContent,
      userName, // Pass user name for personalized normalization
    };

    // Route to appropriate normalization prompt based on content type
    const messages =
      contentType === EpisodeTypeEnum.DOCUMENT
        ? normalizeDocumentPrompt(context)
        : normalizePrompt(context);
    // Normalization is LOW complexity (text cleaning and standardization)
    let responseText = "";
    await makeModelCall(
      false,
      messages,
      (text, _model, usage) => {
        responseText = text;
        if (usage) {
          tokenMetrics.high.input += usage.promptTokens as number;
          tokenMetrics.high.output += usage.completionTokens as number;
          tokenMetrics.high.total += usage.totalTokens as number;
          tokenMetrics.high.cached += (usage.cachedInputTokens as number) || 0;
        }
      },
      undefined,
      "high",
      "normalization",
    );
    let normalizedEpisodeBody = "";
    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      normalizedEpisodeBody = outputMatch[1].trim();
    } else {
      // Log format violation and use fallback
      logger.warn("Normalization response missing <output> tags", {
        responseText: responseText.substring(0, 200) + "...",
        source,
        episodeLength: episodeBody.length,
      });

      // Fallback: use raw response if it's not empty and seems meaningful
      const trimmedResponse = responseText.trim();
      if (
        trimmedResponse &&
        trimmedResponse !== "NOTHING_TO_REMEMBER" &&
        trimmedResponse.length > 10
      ) {
        normalizedEpisodeBody = trimmedResponse;
        logger.info("Using raw response as fallback for normalization", {
          fallbackLength: trimmedResponse.length,
        });
      } else {
        logger.warn("No usable normalization content found", {
          responseText: responseText,
        });
      }
    }

    return normalizedEpisodeBody;
  }

  /**
   * Retrieves related episodes and facts based on semantic similarity to the current episode content.
   *
   * @param episodeContent The content of the current episode
   * @param userId The user ID
   * @param source The source of the episode
   * @param referenceTime The reference time for the episode
   * @returns A string containing formatted related episodes and facts
   */
  private async getRelatedMemories(
    episodeContent: string,
    userId: string,
    options: {
      episodeLimit?: number;
      factLimit?: number;
      minSimilarity?: number;
    } = {},
  ): Promise<string> {
    try {
      // Default configuration values
      const episodeLimit = options.episodeLimit ?? 5;
      const factLimit = options.factLimit ?? 10;
      const minSimilarity = options.minSimilarity ?? 0.75;

      // Get embedding for the current episode content
      const contentEmbedding = await this.getEmbedding(episodeContent);

      // Retrieve semantically similar episodes (excluding very recent ones that are already in context)
      const relatedEpisodes = await searchEpisodesByEmbedding({
        embedding: contentEmbedding,
        userId,
        limit: episodeLimit,
        minSimilarity,
      });

      // Retrieve semantically similar facts/statements
      const relatedFacts = await searchStatementsByEmbedding({
        embedding: contentEmbedding,
        userId,
        limit: factLimit,
        minSimilarity,
      });

      // Format the related memories for inclusion in the prompt
      let formattedMemories = "";

      if (relatedEpisodes.length > 0) {
        formattedMemories += "## Related Episodes\n";
        relatedEpisodes.forEach((episode, index) => {
          formattedMemories += `### Episode ${index + 1} (${new Date(episode.validAt).toISOString()})\n`;
          formattedMemories += `${episode.content || episode.originalContent}\n\n`;
        });
      }

      if (relatedFacts.length > 0) {
        formattedMemories += "## Related Facts\n";
        relatedFacts.forEach((fact) => {
          formattedMemories += `- ${fact.fact}\n`;
        });
      }

      return formattedMemories.trim();
    } catch (error) {
      console.error("Error retrieving related memories:", error);
      return "";
    }
  }

  /**
   * Retrieves active ingestion rules for a specific source and user
   */
  private async getIngestionRulesForSource(
    source: string,
    userId: string,
    prisma: PrismaClient,
  ): Promise<string | null> {
    try {
      // Import prisma here to avoid circular dependencies

      // Get the user's workspace
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { Workspace: true },
      });

      if (!user?.Workspace) {
        return null;
      }

      const integrationAccount = await prisma.integrationAccount.findFirst({
        where: {
          integrationDefinition: {
            slug: source,
          },
          workspaceId: user.Workspace.id,
          isActive: true,
          deleted: null,
        },
      });

      if (!integrationAccount) {
        return null;
      }

      // Fetch active rules for this source
      const rules = await prisma.ingestionRule.findMany({
        where: {
          source: integrationAccount.id,
          workspaceId: user.Workspace.id,
          isActive: true,
          deleted: null,
        },
        select: {
          text: true,
          name: true,
        },
        orderBy: { createdAt: "asc" },
      });

      if (rules.length === 0) {
        return null;
      }

      // Format rules for the prompt
      const formattedRules = rules
        .map((rule, index) => {
          const ruleName = rule.name ? `${rule.name}: ` : `Rule ${index + 1}: `;
          return `${ruleName}${rule.text}`;
        })
        .join("\n");

      return formattedRules;
    } catch (error) {
      console.error("Error retrieving ingestion rules:", error);
      return null;
    }
  }
}
