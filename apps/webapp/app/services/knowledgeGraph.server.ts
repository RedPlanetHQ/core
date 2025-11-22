import { type CoreMessage } from "ai";
import {
  type ExtractedTripleData,
  type AddEpisodeParams,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
  EpisodeTypeEnum,
  type EpisodeType,
  STATEMENT_NODE_PROPERTIES,
} from "@core/types";
import { logger } from "./logger.service";
import crypto from "crypto";
import { dedupeNodes, extractEntities } from "./prompts/nodes";
import {
  extractStatements,
  extractStatementsOSS,
  resolveStatementPrompt,
} from "./prompts/statements";
import {
  getEpisodeStatements,
  getRecentEpisodes,
  searchEpisodesByEmbedding,
} from "./graphModels/episode";
import {
  findExactPredicateMatches,
  findSimilarEntities,
} from "./graphModels/entity";
import {
  findContradictoryStatements,
  findSimilarStatements,
  findStatementsWithSameSubjectObject,
  getTripleForStatement,
  invalidateStatements,
  parseStatementNode,
  saveTriple,
  searchStatementsByEmbedding,
} from "./graphModels/statement";
import {
  getEmbedding,
  makeModelCall,
  isProprietaryModel,
} from "~/lib/model.server";
import { runQuery } from "~/lib/neo4j.server";
import { Apps, getNodeTypesString } from "~/utils/presets/nodes";
import { normalizePrompt, normalizeDocumentPrompt } from "./prompts";
import { type PrismaClient } from "@prisma/client";

// Default number of previous episodes to retrieve for context
const DEFAULT_EPISODE_WINDOW = 5;

export class KnowledgeGraphService {
  async getEmbedding(text: string) {
    return getEmbedding(text);
  }

  /**
   * Invalidate statements from a previous document version that are no longer supported
   * by the new document content using semantic similarity analysis
   */
  async invalidateStatementsFromPreviousDocumentVersion(params: {
    previousDocumentUuid: string;
    newDocumentContent: string;
    userId: string;
    invalidatedBy: string;
    semanticSimilarityThreshold?: number;
    changedChunkIndices?: number[]; // Optional: only invalidate statements from specific chunks
  }): Promise<{
    invalidatedStatements: string[];
    preservedStatements: string[];
    totalStatementsAnalyzed: number;
  }> {
    const threshold = params.semanticSimilarityThreshold || 0.75; // Lower threshold for document-level analysis
    const invalidatedStatements: string[] = [];
    const preservedStatements: string[] = [];

    // Step 1: Get all statements from the previous document version
    const previousStatements = await this.getStatementsFromDocument(
      params.previousDocumentUuid,
      params.userId,
      params.changedChunkIndices, // Pass chunk filter
    );

    if (previousStatements.length === 0) {
      return {
        invalidatedStatements: [],
        preservedStatements: [],
        totalStatementsAnalyzed: 0,
      };
    }

    logger.log(
      `Analyzing ${previousStatements.length} statements from previous document version`,
    );

    // Step 2: Generate embedding for new document content
    const newDocumentEmbedding = await this.getEmbedding(
      params.newDocumentContent,
    );

    // Step 3: For each statement, check if it's still semantically supported by new content
    for (const statement of previousStatements) {
      try {
        // Generate embedding for the statement fact
        const statementEmbedding = await this.getEmbedding(statement.fact);

        // Calculate semantic similarity between statement and new document
        const semanticSimilarity = this.calculateCosineSimilarity(
          statementEmbedding,
          newDocumentEmbedding,
        );

        if (semanticSimilarity < threshold) {
          invalidatedStatements.push(statement.uuid);
          logger.log(
            `Invalidating statement: "${statement.fact}" (similarity: ${semanticSimilarity.toFixed(3)})`,
          );
        } else {
          preservedStatements.push(statement.uuid);
          logger.log(
            `Preserving statement: "${statement.fact}" (similarity: ${semanticSimilarity.toFixed(3)})`,
          );
        }
      } catch (error) {
        logger.error(`Error analyzing statement ${statement.uuid}:`, { error });
        // On error, be conservative and invalidate
        invalidatedStatements.push(statement.uuid);
      }
    }

    // Step 4: Bulk invalidate the selected statements
    if (invalidatedStatements.length > 0) {
      await invalidateStatements({
        statementIds: invalidatedStatements,
        invalidatedBy: params.invalidatedBy,
      });

      logger.log(`Document-level invalidation completed`, {
        previousDocumentUuid: params.previousDocumentUuid,
        totalAnalyzed: previousStatements.length,
        invalidated: invalidatedStatements.length,
        preserved: preservedStatements.length,
        threshold,
      });
    }

    return {
      invalidatedStatements,
      preservedStatements,
      totalStatementsAnalyzed: previousStatements.length,
    };
  }

  /**
   * Get all statements that were created from episodes linked to a specific document
   * Optionally filter by chunk indices for targeted invalidation
   */
  private async getStatementsFromDocument(
    documentUuid: string,
    userId: string,
    chunkIndices?: number[],
  ): Promise<StatementNode[]> {
    // Build query with optional chunk filter
    const chunkFilter =
      chunkIndices && chunkIndices.length > 0
        ? `AND episode.chunkIndex IN $chunkIndices`
        : "";

    const query = `
      MATCH (doc:Document {uuid: $documentUuid, userId: $userId})-[r:CONTAINS_CHUNK]->(episode:Episode)
      WHERE r.chunkIndex IS NOT NULL ${chunkFilter}
      MATCH (episode)-[:HAS_PROVENANCE]->(s:Statement)
      RETURN ${STATEMENT_NODE_PROPERTIES} as statement
    `;

    const result = await runQuery(query, {
      documentUuid,
      userId,
      chunkIndices: chunkIndices || [],
    });

    return result.map((record) => {
      return parseStatementNode(record.get("statement"));
    });
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vector dimensions must match");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
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
  ): Promise<{
    episodeUuid: string | null;
    statementsCreated: number;
    processingTimeMs: number;
    tokenUsage?: {
      high: { input: number; output: number; total: number };
      low: { input: number; output: number; total: number };
    };
  }> {
    const startTime = Date.now();
    const now = new Date();

    // Track token usage by complexity
    const tokenMetrics = {
      high: { input: 0, output: 0, total: 0, cached: 0 },
      low: { input: 0, output: 0, total: 0, cached: 0 },
    };

    try {
      // Step 1: Context Retrieval - Get previous episodes for context
      const previousEpisodes = await getRecentEpisodes({
        referenceTime: params.referenceTime,
        limit: DEFAULT_EPISODE_WINDOW,
        userId: params.userId,
        source: params.source,
        sessionId: params.sessionId,
      });

      // Format session context from previous episodes
      const sessionContext =
        params.sessionId && previousEpisodes.length > 0
          ? previousEpisodes
            .map(
              (ep, i) =>
                `Episode ${i + 1} (${ep.createdAt.toISOString()}): ${ep.content}`,
            )
            .join("\n\n")
          : undefined;

      const normalizedEpisodeBody = await this.normalizeEpisodeBody(
        params.episodeBody,
        params.source,
        params.userId,
        prisma,
        tokenMetrics,
        new Date(params.referenceTime),
        sessionContext,
        params.type,
      );

      const normalizedTime = Date.now();
      logger.log(`Normalized episode body in ${normalizedTime - startTime} ms`);

      if (normalizedEpisodeBody === "NOTHING_TO_REMEMBER") {
        logger.log("Nothing to remember");
        return {
          episodeUuid: null,
          statementsCreated: 0,
          processingTimeMs: 0,
        };
      }

      // Step 2: Episode Creation - Create or retrieve the episode
      const episode: EpisodicNode = {
        uuid: crypto.randomUUID(),
        content: normalizedEpisodeBody,
        originalContent: params.episodeBody,
        contentEmbedding: await this.getEmbedding(normalizedEpisodeBody),
        source: params.source,
        metadata: params.metadata || {},
        createdAt: now,
        validAt: new Date(params.referenceTime),
        labelIds: [],
        userId: params.userId,
        sessionId: params.sessionId,
        documentId: params.documentId,
      };

      // Step 3: Entity Extraction - Extract entities from the episode content
      const extractedNodes = await this.extractEntities(
        episode,
        previousEpisodes,
        tokenMetrics,
      );

      console.log(extractedNodes.map((node) => node.name));

      const extractedTime = Date.now();
      logger.log(`Extracted entities in ${extractedTime - normalizedTime} ms`);

      // Step 3.1: Simple entity categorization (no type-based expansion needed)
      const categorizedEntities = {
        primary: extractedNodes,
        expanded: [], // No expansion needed with type-free approach
      };

      const expandedTime = Date.now();
      logger.log(`Processed entities in ${expandedTime - extractedTime} ms`);

      // Step 4: Statement Extrraction - Extract statements (triples) instead of direct edges
      const extractedStatements = await this.extractStatements(
        episode,
        categorizedEntities,
        previousEpisodes,
        tokenMetrics,
      );

      const extractedStatementsTime = Date.now();
      logger.log(
        `Extracted statements in ${extractedStatementsTime - expandedTime} ms`,
      );
      // Save triples without resolution
      for (const triple of extractedStatements) {
        await saveTriple(triple);
      }

      const saveTriplesTime = Date.now();
      logger.log(`Saved unresolved triples in ${saveTriplesTime - extractedStatementsTime} ms`);

      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;
      logger.log(`Processing time (without resolution): ${processingTimeMs} ms`);

      return {
        episodeUuid: episode.uuid,
        statementsCreated: extractedStatements.length,
        processingTimeMs,
        tokenUsage: tokenMetrics,
      };
    } catch (error) {
      console.error("Error in addEpisode:", error);
      throw error;
    }
  }

  /**
   * Extract entities from an episode using LLM
   */
  private async extractEntities(
    episode: EpisodicNode,
    previousEpisodes: EpisodicNode[],
    tokenMetrics: {
      high: { input: number; output: number; total: number, cached: number };
      low: { input: number; output: number; total: number, cached: number };
    },
  ): Promise<EntityNode[]> {
    // Use the prompt library to get the appropriate prompts
    const context = {
      episodeContent: episode.content,
      previousEpisodes: previousEpisodes.map((ep) => ({
        content: ep.content,
        createdAt: ep.createdAt.toISOString(),
      })),
    };

    // Get the unified entity extraction prompt
    const extractionMode = episode.sessionId ? "conversation" : "document";
    const messages = extractEntities(context, extractionMode);

    let responseText = "";

    // Entity extraction requires HIGH complexity (creative reasoning, nuanced NER)
    await makeModelCall(
      false,
      messages as CoreMessage[],
      (text, _model, usage) => {
        responseText = text;
        if (usage) {
          tokenMetrics.high.input += usage.promptTokens as number;
          tokenMetrics.high.output += usage.completionTokens as number;
          tokenMetrics.high.total += usage.totalTokens as number;
          tokenMetrics.high.cached += usage.cachedInputTokens as number || 0;
        }
      },
      undefined,
      "high",
      "entity-extraction",
    );

    // Convert to EntityNode objects
    let entities: EntityNode[] = [];

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);

    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
      const parsedResponse = JSON.parse(responseText || "[]");
      // Handle both old format {entities: [...]} and new format [...]
      const extractedEntities = Array.isArray(parsedResponse)
        ? parsedResponse
        : parsedResponse.entities || [];

      // Batch generate embeddings for entity names
      const entityNames = Array.isArray(extractedEntities[0])
        ? extractedEntities
        : extractedEntities.map((entity: any) => entity.name || entity);
      const nameEmbeddings = await Promise.all(
        entityNames.map((name: string) => this.getEmbedding(name)),
      );

      entities = extractedEntities.map((entity: any, index: number) => ({
        uuid: crypto.randomUUID(),
        name: typeof entity === "string" ? entity : entity.name,
        type: undefined, // Type will be inferred from statements
        attributes: typeof entity === "string" ? {} : entity.attributes || {},
        nameEmbedding: nameEmbeddings[index],
        typeEmbedding: undefined, // No type embedding needed
        createdAt: new Date(),
        userId: episode.userId,
      }));
    }

    return entities;
  }

  /**
   * Extract statements as first-class objects from an episode using LLM
   * This replaces the previous extractEdges method with a reified approach
   */
  private async extractStatements(
    episode: EpisodicNode,
    categorizedEntities: {
      primary: EntityNode[];
      expanded: EntityNode[];
    },
    previousEpisodes: EpisodicNode[],
    tokenMetrics: {
      high: { input: number; output: number; total: number, cached: number };
      low: { input: number; output: number; total: number, cached: number };
    },
  ): Promise<Triple[]> {
    // Use the prompt library to get the appropriate prompts
    const context = {
      episodeContent: episode.content,
      previousEpisodes: previousEpisodes.map((ep) => ({
        content: ep.content,
        createdAt: ep.createdAt.toISOString(),
      })),
      entities: {
        primary: categorizedEntities.primary.map((node) => ({
          name: node.name,
          type: node.type,
        })),
        expanded: categorizedEntities.expanded.map((node) => ({
          name: node.name,
          type: node.type,
        })),
      },
      referenceTime: episode.validAt.toISOString(),
    };

    console.log("proprietary model", isProprietaryModel(undefined, "high"));
    // Statement extraction requires HIGH complexity (causal reasoning, emotional context)
    // Choose between proprietary and OSS prompts based on model type
    const messages = isProprietaryModel(undefined, "high")
      ? extractStatements(context)
      : extractStatementsOSS(context);

    let responseText = "";
    await makeModelCall(
      false,
      messages as CoreMessage[],
      (text, _model, usage) => {
        responseText = text;
        if (usage) {
          tokenMetrics.high.input += usage.promptTokens as number;
          tokenMetrics.high.output += usage.completionTokens as number;
          tokenMetrics.high.total += usage.totalTokens as number;
          tokenMetrics.high.cached += usage.cachedInputTokens as number || 0;
        }
      },
      undefined,
      "high",
      "statement-extraction",
    );

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
    } else {
      responseText = "{}";
    }

    // Parse the statements from the LLM response
    const parsedResponse = JSON.parse(responseText || "[]");
    // Handle both old format {"edges": [...]} and new format [...]
    const extractedTriples: ExtractedTripleData[] = Array.isArray(
      parsedResponse,
    )
      ? parsedResponse
      : parsedResponse.edges || [];

    console.log(`extracted triples length: ${extractedTriples.length}`);

    // Create maps to deduplicate entities by name within this extraction
    const predicateMap = new Map<string, EntityNode>();

    // First pass: collect all unique predicates from the current extraction
    for (const triple of extractedTriples) {
      const predicateName = triple.predicate.toLowerCase();
      if (!predicateMap.has(predicateName)) {
        // Create new predicate (embedding will be generated later in batch)
        const newPredicate = {
          uuid: crypto.randomUUID(),
          name: triple.predicate,
          type: "Predicate",
          attributes: {},
          nameEmbedding: null as any, // Will be filled later
          typeEmbedding: null as any, // Will be filled later
          createdAt: new Date(),
          userId: episode.userId,
        };
        predicateMap.set(predicateName, newPredicate);
      }
    }

    // Combine primary and expanded entities for entity matching
    const allEntities = [
      ...categorizedEntities.primary,
      ...categorizedEntities.expanded,
    ];

    // Batch generate embeddings for predicates and facts
    const uniquePredicates = Array.from(predicateMap.values());
    const factTexts = extractedTriples.map((t) => t.fact);
    const predicateNames = uniquePredicates.map((p) => p.name);

    const [predicateNameEmbeddings, predicateTypeEmbeddings, factEmbeddings] =
      await Promise.all([
        Promise.all(predicateNames.map((name) => this.getEmbedding(name))),
        Promise.all(predicateNames.map(() => this.getEmbedding("Predicate"))),
        Promise.all(factTexts.map((fact) => this.getEmbedding(fact))),
      ]);

    // Update predicate embeddings
    uniquePredicates.forEach((predicate, index) => {
      predicate.nameEmbedding = predicateNameEmbeddings[index];
    });

    // Convert extracted triples to Triple objects with Statement nodes
    const triples = extractedTriples.map(
      (triple: ExtractedTripleData, tripleIndex: number) => {
        // Find the subject and object nodes by matching name (type-free approach)
        const subjectNode = allEntities.find(
          (node) => node.name.toLowerCase() === triple.source.toLowerCase(),
        );

        const objectNode = allEntities.find(
          (node) => node.name.toLowerCase() === triple.target.toLowerCase(),
        );

        // Get the deduplicated predicate node
        const predicateNode = predicateMap.get(triple.predicate.toLowerCase());

        if (subjectNode && objectNode && predicateNode) {
          // Determine the correct validAt date (when the fact actually occurred/occurs)
          let validAtDate = episode.validAt; // Default fallback to episode date

          // Check if statement has event_date indicating when the fact actually happened/happens
          if (triple.attributes?.event_date) {
            try {
              const eventDate = new Date(triple.attributes.event_date);
              // Use the event date as validAt (when the fact is actually true)
              if (!isNaN(eventDate.getTime())) {
                validAtDate = eventDate;
              }
            } catch (error) {
              // If parsing fails, use episode validAt as fallback
              logger.log(
                `Failed to parse event_date: ${triple.attributes.event_date}, using episode validAt`,
              );
            }
          }

          // Create a statement node
          const statement: StatementNode = {
            uuid: crypto.randomUUID(),
            fact: triple.fact,
            factEmbedding: factEmbeddings[tripleIndex],
            createdAt: new Date(),
            validAt: validAtDate,
            invalidAt: null,
            attributes: triple.attributes || {},
            userId: episode.userId,
          };

          return {
            statement,
            subject: subjectNode,
            predicate: predicateNode,
            object: objectNode,
            provenance: episode,
          };
        }
        return null;
      },
    );

    // Filter out null values (where subject or object wasn't found)
    return triples.filter(Boolean) as Triple[];
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
      high: { input: number; output: number; total: number, cached: number };
      low: { input: number; output: number; total: number, cached: number };
    },
    episodeTimestamp?: Date,
    sessionContext?: string,
    contentType?: EpisodeType,
  ) {
    let appEnumValues: Apps[] = [];
    if (Apps[source.toUpperCase() as keyof typeof Apps]) {
      appEnumValues = [Apps[source.toUpperCase() as keyof typeof Apps]];
    }
    const entityTypes = getNodeTypesString(appEnumValues);
    const relatedMemories = await this.getRelatedMemories(episodeBody, userId);

    // Fetch ingestion rules for this source
    const ingestionRules = await this.getIngestionRulesForSource(
      source,
      userId,
      prisma,
    );

    const context = {
      episodeContent: episodeBody,
      entityTypes: entityTypes,
      source,
      relatedMemories,
      ingestionRules,
      episodeTimestamp:
        episodeTimestamp?.toISOString() || new Date().toISOString(),
      sessionContext,
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
          tokenMetrics.high.cached += usage.cachedInputTokens as number || 0;
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
          formattedMemories += `${episode.content}\n\n`;
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
