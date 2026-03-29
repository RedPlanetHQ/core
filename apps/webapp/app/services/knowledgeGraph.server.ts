import {
  type AddEpisodeParams,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
  type VoiceAspect,
  type VoiceAspectNode,
  EpisodeTypeEnum,
  EpisodeType,
  type AddEpisodeResult,
  EntityTypes,
} from "@core/types";
import { logger } from "./logger.service";
import crypto from "crypto";
import {
  extractWorldPrompt,
  ExtractWorldSchema,
} from "./prompts/extract-world";
import {
  extractVoicePrompt,
  ExtractVoiceSchema,
} from "./prompts/extract-voice";
import {
  classifyVoicePrompt,
  ClassifyVoiceSchema,
} from "./prompts/classify-voice";
import {
  classifyWorldPrompt,
  ClassifyWorldSchema,
} from "./prompts/classify-world";
import {
  reflectVoicePrompt,
  ReflectVoiceSchema,
} from "./prompts/reflect-voice";
import {
  reflectWorldPrompt,
  ReflectWorldSchema,
} from "./prompts/reflect-world";
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
import { saveVoiceAspects } from "./aspectStore.server";
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
          workspaceId: params.workspaceId,
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

      // console.log("previousEpisodes: ", previousEpisodes);
      // console.log("previousVersionContent: ", previousVersionContent);

      const normalizedEpisodeBody = await this.normalizeEpisodeBody(
        params.episodeBody,
        params.source,
        params.userId,
        params.workspaceId as string,
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
          voiceAspectsCreated: 0,
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
        params.workspaceId as string,
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

      // Step 3: Comprehend + Evaluate — extract voice facts and graph facts
      const { voiceAspects, graphTriples } = await this.comprehendAndClassify(
        episode,
        previousEpisodes,
        tokenMetrics,
        params.userName,
      );
      const extractedStatementsTime = Date.now();
      logger.log(
        `Comprehend + classify completed in ${extractedStatementsTime - episodeUpdatedTime} ms`,
      );

      // Step 4a: Save graph triples to Neo4j
      for (const triple of graphTriples) {
        await saveTriple(triple);
      }

      // Step 4b: Save voice aspects to Aspects Store
      let savedVoiceAspects: VoiceAspectNode[] = [];
      if (voiceAspects.length > 0) {
        savedVoiceAspects = await saveVoiceAspects(
          voiceAspects.map((va) => ({
            fact: va.fact,
            aspect: va.aspect,
            episodeUuid: episode.uuid,
            userId: params.userId,
            workspaceId: params.workspaceId as string,
          })),
        );
        logger.log(
          `Saved ${savedVoiceAspects.length} voice aspects to aspects store`,
        );
      }

      // Step 5: Generate and store embeddings for graph triples
      if (graphTriples.length > 0) {
        const uniqueEntities = new Map<string, EntityNode>();
        const facts: Array<{ uuid: string; text: string }> = [];

        for (const triple of graphTriples) {
          facts.push({
            uuid: triple.statement.uuid,
            text: triple.statement.fact,
          });

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
        const entities = Array.from(uniqueEntities.values());
        const [factEmbeddings, entityEmbeddings] = await Promise.all([
          Promise.all(facts.map((f) => this.getEmbedding(f.text))),
          Promise.all(entities.map((e) => this.getEmbedding(e.name))),
        ]);
        const embeddingEndTime = Date.now();
        logger.log(
          `Generated embeddings in ${embeddingEndTime - embeddingTime} ms`,
        );

        await batchStoreStatementEmbeddings(
          facts.map((fact, index) => ({
            uuid: fact.uuid,
            fact: fact.text,
            embedding: factEmbeddings[index],
            userId: params.userId,
          })),
          params.workspaceId as string,
        );

        await batchStoreEntityEmbeddings(
          entities.map((entity, index) => ({
            uuid: entity.uuid,
            name: entity.name,
            embedding: entityEmbeddings[index],
            userId: params.userId,
          })),
          params.workspaceId as string,
        );
        logger.log(`Stored embeddings in ${Date.now() - embeddingEndTime} ms`);
      }

      const saveTriplesTime = Date.now();
      logger.log(
        `Saved ${graphTriples.length} triples + ${savedVoiceAspects.length} voice aspects in ${saveTriplesTime - extractedStatementsTime} ms`,
      );

      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;
      logger.log(
        `Processing time (without resolution): ${processingTimeMs} ms`,
      );

      return {
        type: params.type || EpisodeType.CONVERSATION,
        episodeUuid: episode.uuid,
        statementsCreated: graphTriples.length,
        voiceAspectsCreated: savedVoiceAspects.length,
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
   * Comprehend + Classify: 3-step extraction pipeline
   *
   * Step 1: Comprehend+Evaluate — extract voice facts and graph facts from episode
   * Step 2a: Classify Voice — classify voice facts into Directive/Preference/Habit/Belief/Goal
   * Step 2b: Classify World — classify graph facts into Identity/Event/Relationship/Decision/Knowledge
   *
   * Returns voice aspects (for aspects store) and graph triples (for Neo4j).
   */
  private async comprehendAndClassify(
    episode: EpisodicNode,
    previousEpisodes: EpisodeEmbedding[],
    tokenMetrics: {
      high: { input: number; output: number; total: number; cached: number };
      low: { input: number; output: number; total: number; cached: number };
    },
    userName?: string,
  ): Promise<{
    voiceAspects: Array<{ fact: string; aspect: VoiceAspect }>;
    graphTriples: Triple[];
  }> {
    const context = {
      episodeContent: episode.content,
      userName,
    };

    // Step 1: Extract world + voice in parallel (both use high model)
    const [worldExtract, voiceExtract] = await Promise.all([
      // Extract world facts (graph)
      (async () => {
        const worldMessages = extractWorldPrompt(context);
        const { object: worldResult, usage: worldUsage } =
          await makeStructuredModelCall(
            ExtractWorldSchema,
            worldMessages as ModelMessage[],
            "medium",
            "extract-world",
            undefined,
            episode.workspaceId,
            "memory",
          );
        if (worldUsage) {
          tokenMetrics.high.input += worldUsage.promptTokens as number;
          tokenMetrics.high.output += worldUsage.completionTokens as number;
          tokenMetrics.high.total += worldUsage.totalTokens as number;
          tokenMetrics.high.cached +=
            (worldUsage.cachedInputTokens as number) || 0;
        }
        return worldResult;
      })(),

      // Extract voice facts
      (async () => {
        const voiceMessages = extractVoicePrompt(context);
        const { object: voiceResult, usage: voiceUsage } =
          await makeStructuredModelCall(
            ExtractVoiceSchema,
            voiceMessages as ModelMessage[],
            "medium",
            "extract-voice",
            undefined,
            episode.workspaceId,
            "memory",
          );
        if (voiceUsage) {
          tokenMetrics.high.input += voiceUsage.promptTokens as number;
          tokenMetrics.high.output += voiceUsage.completionTokens as number;
          tokenMetrics.high.total += voiceUsage.totalTokens as number;
          tokenMetrics.high.cached +=
            (voiceUsage.cachedInputTokens as number) || 0;
        }
        return voiceResult;
      })(),
    ]);

    logger.log(
      `Extract: ${voiceExtract.voice_facts.length} voice facts, ${worldExtract.graph_facts.length} graph facts, ${worldExtract.entities.length} entities`,
    );

    // Step 1.5: Reflect — filter session noise from extracted facts before classification.
    // Falls back to original extracted facts if the reflect call fails (graceful degradation).
    const [reflectedWorld, reflectedVoice] = await Promise.all([
      worldExtract.graph_facts.length > 0
        ? (async () => {
            try {
              const reflectMessages = reflectWorldPrompt(
                worldExtract.graph_facts,
                episode.content,
              );
              const { object: reflectResult, usage: reflectUsage } =
                await makeStructuredModelCall(
                  ReflectWorldSchema,
                  reflectMessages as ModelMessage[],
                  "low",
                  "reflect-world",
                  undefined,
                  episode.workspaceId,
                  "memory",
                );
              if (reflectUsage) {
                tokenMetrics.low.input += reflectUsage.promptTokens as number;
                tokenMetrics.low.output +=
                  reflectUsage.completionTokens as number;
                tokenMetrics.low.total += reflectUsage.totalTokens as number;
                tokenMetrics.low.cached +=
                  (reflectUsage.cachedInputTokens as number) || 0;
              }
              return reflectResult;
            } catch (err) {
              logger.warn(
                "reflect-world failed, falling back to extracted facts",
                { error: err },
              );
              return { graph_facts: worldExtract.graph_facts };
            }
          })()
        : Promise.resolve({ graph_facts: [] }),

      voiceExtract.voice_facts.length > 0
        ? (async () => {
            try {
              const reflectMessages = reflectVoicePrompt(
                voiceExtract.voice_facts,
                episode.content,
              );
              const { object: reflectResult, usage: reflectUsage } =
                await makeStructuredModelCall(
                  ReflectVoiceSchema,
                  reflectMessages as ModelMessage[],
                  "low",
                  "reflect-voice",
                  undefined,
                  episode.workspaceId,
                  "memory",
                );
              if (reflectUsage) {
                tokenMetrics.low.input += reflectUsage.promptTokens as number;
                tokenMetrics.low.output +=
                  reflectUsage.completionTokens as number;
                tokenMetrics.low.total += reflectUsage.totalTokens as number;
                tokenMetrics.low.cached +=
                  (reflectUsage.cachedInputTokens as number) || 0;
              }
              return reflectResult;
            } catch (err) {
              logger.warn(
                "reflect-voice failed, falling back to extracted facts",
                { error: err },
              );
              return { voice_facts: voiceExtract.voice_facts };
            }
          })()
        : Promise.resolve({ voice_facts: [] }),
    ]);

    logger.log(
      `Reflect: ${reflectedVoice.voice_facts.length}/${voiceExtract.voice_facts.length} voice facts kept, ${reflectedWorld.graph_facts.length}/${worldExtract.graph_facts.length} graph facts kept`,
    );

    // Step 2: Classify in parallel (both use low model)
    const [classifiedVoice, classifiedWorld] = await Promise.all([
      // Classify voice facts (if any)
      reflectedVoice.voice_facts.length > 0
        ? (async () => {
            const voiceMessages = classifyVoicePrompt(
              reflectedVoice.voice_facts,
            );
            const { object: voiceResult, usage: voiceUsage } =
              await makeStructuredModelCall(
                ClassifyVoiceSchema,
                voiceMessages as ModelMessage[],
                "medium",
                "classify-voice",
                undefined,
                episode.workspaceId,
                "memory",
              );
            if (voiceUsage) {
              tokenMetrics.low.input += voiceUsage.promptTokens as number;
              tokenMetrics.low.output += voiceUsage.completionTokens as number;
              tokenMetrics.low.total += voiceUsage.totalTokens as number;
              tokenMetrics.low.cached +=
                (voiceUsage.cachedInputTokens as number) || 0;
            }
            return voiceResult.aspects;
          })()
        : Promise.resolve([]),

      // Classify graph facts (if any)
      reflectedWorld.graph_facts.length > 0
        ? (async () => {
            const worldMessages = classifyWorldPrompt(
              reflectedWorld.graph_facts,
              userName,
            );
            const { object: worldResult, usage: worldUsage } =
              await makeStructuredModelCall(
                ClassifyWorldSchema,
                worldMessages as ModelMessage[],
                "medium",
                "classify-world",
                undefined,
                episode.workspaceId,
                "memory",
              );
            if (worldUsage) {
              tokenMetrics.low.input += worldUsage.promptTokens as number;
              tokenMetrics.low.output += worldUsage.completionTokens as number;
              tokenMetrics.low.total += worldUsage.totalTokens as number;
              tokenMetrics.low.cached +=
                (worldUsage.cachedInputTokens as number) || 0;
            }
            return worldResult.facts;
          })()
        : Promise.resolve([]),
    ]);

    logger.log(
      `Classified: ${classifiedVoice.length} voice aspects, ${classifiedWorld.length} graph facts`,
    );

    // Build entity map from extract-world result
    const entityMap = new Map<string, EntityNode>();
    for (const entity of worldExtract.entities) {
      const entityNode: EntityNode = {
        uuid: crypto.randomUUID(),
        name: entity.name,
        type: (EntityTypes as readonly string[]).includes(entity.type as string)
          ? (entity.type as EntityNode["type"])
          : undefined,
        attributes: entity.attributes || {},
        nameEmbedding: [],
        createdAt: new Date(),
        userId: episode.userId,
        workspaceId: episode.workspaceId,
      };
      entityMap.set(entity.name.toLowerCase(), entityNode);
    }

    // Build predicate map
    const predicateMap = new Map<string, EntityNode>();
    for (const stmt of classifiedWorld) {
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
          workspaceId: episode.workspaceId,
        });
      }
    }

    // Convert classified world facts to Triple objects
    const graphTriples = classifiedWorld.map((stmt) => {
      let subjectNode = entityMap.get(stmt.source.toLowerCase());
      if (!subjectNode) {
        subjectNode = {
          uuid: crypto.randomUUID(),
          name: stmt.source,
          type: undefined,
          attributes: {},
          nameEmbedding: [],
          createdAt: new Date(),
          userId: episode.userId,
          workspaceId: episode.workspaceId,
        };
        entityMap.set(stmt.source.toLowerCase(), subjectNode);
      }

      let objectNode = entityMap.get(stmt.target.toLowerCase());
      if (!objectNode) {
        objectNode = {
          uuid: crypto.randomUUID(),
          name: stmt.target,
          type: undefined,
          attributes: {},
          nameEmbedding: [],
          createdAt: new Date(),
          userId: episode.userId,
          workspaceId: episode.workspaceId,
        };
        entityMap.set(stmt.target.toLowerCase(), objectNode);
      }

      const predicateNode = predicateMap.get(stmt.predicate.toLowerCase())!;

      const attributes: Record<string, any> = {};
      if (stmt.event_date) attributes.event_date = stmt.event_date;

      const statement: StatementNode = {
        uuid: crypto.randomUUID(),
        fact: stmt.fact,
        factEmbedding: [],
        createdAt: new Date(),
        validAt: episode.validAt,
        invalidAt: null,
        attributes,
        aspect: stmt.aspect || null,
        userId: episode.userId,
        workspaceId: episode.workspaceId,
      };

      return {
        statement,
        subject: subjectNode,
        predicate: predicateNode,
        object: objectNode,
        provenance: episode,
      };
    }) as Triple[];

    // Voice aspects — filter out null-classified (rejected by classifier) and send to aspects store
    const voiceAspects = classifiedVoice
      .filter((va) => va.aspect !== null)
      .map((va) => ({
        fact: va.fact,
        aspect: va.aspect as VoiceAspect,
      }));

    return { voiceAspects, graphTriples };
  }

  /**
   * Normalize an episode by extracting entities and creating nodes and statements
   */
  private async normalizeEpisodeBody(
    episodeBody: string,
    source: string,
    userId: string,
    workspaceId: string,
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
      workspaceId,
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
      "medium",
      "normalization",
      undefined,
      workspaceId,
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
    workspaceId: string,
    prisma: PrismaClient,
  ): Promise<string | null> {
    try {
      // Import prisma here to avoid circular dependencies

      if (!workspaceId) {
        return null;
      }

      const integrationAccount = await prisma.integrationAccount.findFirst({
        where: {
          integrationDefinition: {
            slug: source,
          },
          workspaceId,
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
          workspaceId,
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
