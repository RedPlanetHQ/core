import { openai } from "@ai-sdk/openai";
import { type CoreMessage, embed } from "ai";
import {
  EpisodeType,
  LLMModelEnum,
  type AddEpisodeParams,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
} from "@core/types";
import { logger } from "./logger.service";
import crypto from "crypto";
import { dedupeNodes, extractMessage, extractText } from "./prompts/nodes";
import {
  extractStatements,
  resolveStatementPrompt,
} from "./prompts/statements";
import { getRecentEpisodes } from "./graphModels/episode";
import { findSimilarEntities } from "./graphModels/entity";
import {
  findContradictoryStatements,
  findSimilarStatements,
  getTripleForStatement,
  invalidateStatements,
  saveTriple,
} from "./graphModels/statement";
import { makeModelCall } from "~/lib/model.server";
import { Apps, getNodeTypes, getNodeTypesString } from "~/utils/presets/nodes";
import { normalizePrompt } from "./prompts";

// Default number of previous episodes to retrieve for context
const DEFAULT_EPISODE_WINDOW = 5;
const RELEVANT_SCHEMA_LIMIT = 10;

export class KnowledgeGraphService {
  async getEmbedding(text: string) {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });

    return embedding;
  }

  /**
   * Process an episode and update the knowledge graph.
   *
   * This method extracts information from the episode, creates nodes and statements,
   * and updates the HelixDB database according to the reified + temporal approach.
   */
  async addEpisode(params: AddEpisodeParams) {
    const startTime = Date.now();
    const now = new Date();

    try {
      // Step 1: Context Retrieval - Get previous episodes for context
      const previousEpisodes = await getRecentEpisodes({
        referenceTime: params.referenceTime,
        limit: DEFAULT_EPISODE_WINDOW,
        userId: params.userId,
        source: params.source,
      });

      const normalizedEpisodeBody = await this.normalizeEpisodeBody(
        params.episodeBody,
        params.source,
      );

      // Step 2: Episode Creation - Create or retrieve the episode
      const episode: EpisodicNode = {
        uuid: crypto.randomUUID(),
        content: normalizedEpisodeBody,
        originalContent: params.episodeBody,
        source: params.source,
        type: params.type || EpisodeType.Text,
        createdAt: now,
        validAt: new Date(params.referenceTime),
        labels: [],
        userId: params.userId,
        space: params.spaceId,
        sessionId: params.sessionId,
      };

      // Step 3: Entity Extraction - Extract entities from the episode content
      const extractedNodes = await this.extractEntities(
        episode,
        previousEpisodes,
      );

      // Step 4: Statement Extraction - Extract statements (triples) instead of direct edges
      const extractedStatements = await this.extractStatements(
        episode,
        extractedNodes,
        previousEpisodes,
      );

      // Step 5: Entity Resolution - Resolve extracted nodes to existing nodes or create new ones
      const resolvedTriples = await this.resolveExtractedNodes(
        extractedStatements,
        episode,
        previousEpisodes,
      );

      // Step 6: Statement Resolution - Resolve statements and detect contradictions
      const { resolvedStatements, invalidatedStatements } =
        await this.resolveStatements(resolvedTriples, episode);

      // Save triples sequentially to avoid parallel processing issues
      for (const triple of resolvedStatements) {
        await saveTriple(triple);
      }

      // Invalidate invalidated statements
      await invalidateStatements({ statementIds: invalidatedStatements });

      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;
      logger.log(`Processing time: ${processingTimeMs} ms`);

      return {
        episodeUuid: episode.uuid,
        // nodesCreated: hydratedNodes.length,
        statementsCreated: resolvedStatements.length,
        processingTimeMs,
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
  ): Promise<EntityNode[]> {
    // Get all app keys
    const allAppEnumValues = Object.values(Apps);

    // Get all node types
    const entityTypes = getNodeTypes(allAppEnumValues);

    // Use the prompt library to get the appropriate prompts
    const context = {
      episodeContent: episode.content,
      previousEpisodes: previousEpisodes.map((ep) => ({
        content: ep.content,
        createdAt: ep.createdAt.toISOString(),
      })),
      entityTypes: entityTypes,
    };

    // Get the extract_json prompt from the prompt library
    const messages =
      episode.type === EpisodeType.Conversation
        ? extractMessage(context)
        : extractText(context);

    let responseText = "";

    await makeModelCall(
      false,
      LLMModelEnum.GPT41,
      messages as CoreMessage[],
      (text) => {
        responseText = text;
      },
    );

    // Convert to EntityNode objects
    const entities: EntityNode[] = [];

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
      const extractedEntities = JSON.parse(responseText || "{}").entities || [];

      entities.push(
        ...(await Promise.all(
          extractedEntities.map(async (entity: any) => ({
            uuid: crypto.randomUUID(),
            name: entity.name,
            type: entity.type,
            attributes: entity.attributes || {},
            nameEmbedding: await this.getEmbedding(
              `${entity.type}: ${entity.name}`,
            ),
            createdAt: new Date(),
            userId: episode.userId,
          })),
        )),
      );
    }

    return entities;
  }

  /**
   * Extract statements as first-class objects from an episode using LLM
   * This replaces the previous extractEdges method with a reified approach
   */
  private async extractStatements(
    episode: EpisodicNode,
    extractedEntities: EntityNode[],
    previousEpisodes: EpisodicNode[],
  ): Promise<Triple[]> {
    // Use the prompt library to get the appropriate prompts
    const context = {
      episodeContent: episode.content,
      previousEpisodes: previousEpisodes.map((ep) => ({
        content: ep.content,
        createdAt: ep.createdAt.toISOString(),
      })),
      entities: extractedEntities.map((node) => ({
        name: node.name,
        type: node.type,
      })),
      referenceTime: episode.validAt.toISOString(),
    };

    // Get the statement extraction prompt from the prompt library
    const messages = extractStatements(context);

    let responseText = "";
    await makeModelCall(
      false,
      LLMModelEnum.GPT41,
      messages as CoreMessage[],
      (text) => {
        responseText = text;
      },
    );

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
    } else {
      responseText = "{}";
    }

    // Parse the statements from the LLM response
    const extractedTriples = JSON.parse(responseText || "{}").edges || [];

    // Convert extracted triples to Triple objects with Statement nodes
    const triples = await Promise.all(
      // Fix: Type 'any'.
      extractedTriples.map(async (triple: any) => {
        // Find the subject and object nodes
        const subjectNode = extractedEntities.find(
          (node) => node.name.toLowerCase() === triple.source.toLowerCase(),
        );

        const objectNode = extractedEntities.find(
          (node) => node.name.toLowerCase() === triple.target.toLowerCase(),
        );

        // Find or create a predicate node for the relationship type
        const predicateNode = extractedEntities.find(
          (node) => node.name.toLowerCase() === triple.predicate.toLowerCase(),
        ) || {
          uuid: crypto.randomUUID(),
          name: triple.predicate,
          type: "Predicate",
          attributes: {},
          nameEmbedding: await this.getEmbedding(triple.predicate),
          createdAt: new Date(),
          userId: episode.userId,
        };

        if (subjectNode && objectNode) {
          // Create a statement node
          const statement: StatementNode = {
            uuid: crypto.randomUUID(),
            fact: triple.fact,
            factEmbedding: await this.getEmbedding(triple.fact),
            createdAt: new Date(),
            validAt: episode.validAt,
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
      }),
    );

    // Filter out null values (where subject or object wasn't found)
    return triples.filter(Boolean) as Triple[];
  }

  /**
   * Resolve extracted nodes to existing nodes or create new ones
   */
  private async resolveExtractedNodes(
    triples: Triple[],
    episode: EpisodicNode,
    previousEpisodes: EpisodicNode[],
  ): Promise<Triple[]> {
    // Step 1: Extract unique entities from triples
    const uniqueEntitiesMap = new Map<string, EntityNode>();
    const entityIdToPositions = new Map<
      string,
      Array<{
        tripleIndex: number;
        position: "subject" | "predicate" | "object";
      }>
    >();

    // First pass: collect all unique entities and their positions in triples
    triples.forEach((triple, tripleIndex) => {
      // Process subject
      if (!uniqueEntitiesMap.has(triple.subject.uuid)) {
        uniqueEntitiesMap.set(triple.subject.uuid, triple.subject);
      }
      if (!entityIdToPositions.has(triple.subject.uuid)) {
        entityIdToPositions.set(triple.subject.uuid, []);
      }
      entityIdToPositions.get(triple.subject.uuid)!.push({
        tripleIndex,
        position: "subject",
      });

      // Process predicate
      if (!uniqueEntitiesMap.has(triple.predicate.uuid)) {
        uniqueEntitiesMap.set(triple.predicate.uuid, triple.predicate);
      }
      if (!entityIdToPositions.has(triple.predicate.uuid)) {
        entityIdToPositions.set(triple.predicate.uuid, []);
      }
      entityIdToPositions.get(triple.predicate.uuid)!.push({
        tripleIndex,
        position: "predicate",
      });

      // Process object
      if (!uniqueEntitiesMap.has(triple.object.uuid)) {
        uniqueEntitiesMap.set(triple.object.uuid, triple.object);
      }
      if (!entityIdToPositions.has(triple.object.uuid)) {
        entityIdToPositions.set(triple.object.uuid, []);
      }
      entityIdToPositions.get(triple.object.uuid)!.push({
        tripleIndex,
        position: "object",
      });
    });

    // Convert to arrays for processing
    const uniqueEntities = Array.from(uniqueEntitiesMap.values());

    // Step 2: Find similar entities for each unique entity
    const similarEntitiesResults = await Promise.all(
      uniqueEntities.map(async (entity) => {
        const similarEntities = await findSimilarEntities({
          queryEmbedding: entity.nameEmbedding,
          limit: 5,
          threshold: 0.85,
        });
        return {
          entity,
          similarEntities,
        };
      }),
    );

    // If no similar entities found for any entity, return original triples
    if (similarEntitiesResults.length === 0) {
      return triples;
    }

    // Step 3: Prepare context for LLM deduplication
    const dedupeContext = {
      extracted_nodes: similarEntitiesResults.map((result, index) => ({
        id: index,
        name: result.entity.name,
        entity_type: result.entity.type,
        duplication_candidates: result.similarEntities.map((candidate, j) => ({
          idx: j,
          name: candidate.name,
          entity_types: candidate.type,
        })),
      })),
      episode_content: episode ? episode.content : "",
      previous_episodes: previousEpisodes
        ? previousEpisodes.map((ep) => ep.content)
        : [],
    };

    // Step 4: Call LLM to resolve duplicates
    const messages = dedupeNodes(dedupeContext);
    let responseText = "";

    await makeModelCall(
      false,
      LLMModelEnum.GPT41,
      messages as CoreMessage[],
      (text) => {
        responseText = text;
      },
    );

    // Step 5: Process LLM response
    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (!outputMatch || !outputMatch[1]) {
      return triples; // Return original if parsing fails
    }

    try {
      responseText = outputMatch[1].trim();
      const parsedResponse = JSON.parse(responseText);
      const nodeResolutions = parsedResponse.entity_resolutions || [];

      // Step 6: Create mapping from original entity UUID to resolved entity
      const entityResolutionMap = new Map<string, EntityNode>();

      nodeResolutions.forEach((resolution: any, index: number) => {
        const originalEntity = uniqueEntities[resolution.id ?? index];
        if (!originalEntity) return;

        const duplicateIdx = resolution.duplicate_idx ?? -1;

        // Get the corresponding result from similarEntitiesResults
        const resultEntry = similarEntitiesResults.find(
          (result) => result.entity.uuid === originalEntity.uuid,
        );

        if (!resultEntry) return;

        // If a duplicate was found, use that entity, otherwise keep original
        const resolvedEntity =
          duplicateIdx >= 0 && duplicateIdx < resultEntry.similarEntities.length
            ? resultEntry.similarEntities[duplicateIdx]
            : originalEntity;

        // Update name if provided
        if (resolution.name) {
          resolvedEntity.name = resolution.name;
        }

        // Map original UUID to resolved entity
        entityResolutionMap.set(originalEntity.uuid, resolvedEntity);
      });

      // Step 7: Reconstruct triples with resolved entities
      const resolvedTriples = triples.map((triple) => {
        const newTriple = { ...triple };

        // Replace subject if resolved
        if (entityResolutionMap.has(triple.subject.uuid)) {
          newTriple.subject = entityResolutionMap.get(triple.subject.uuid)!;
        }

        // Replace predicate if resolved
        if (entityResolutionMap.has(triple.predicate.uuid)) {
          newTriple.predicate = entityResolutionMap.get(triple.predicate.uuid)!;
        }

        // Replace object if resolved
        if (entityResolutionMap.has(triple.object.uuid)) {
          newTriple.object = entityResolutionMap.get(triple.object.uuid)!;
        }

        return newTriple;
      });

      return resolvedTriples;
    } catch (error) {
      console.error("Error processing entity resolutions:", error);
      return triples; // Return original triples on error
    }
  }

  /**
   * Resolve statements by checking for existing statements and handling contradictions
   * This replaces the previous resolveExtractedEdges method with a reified approach
   */
  private async resolveStatements(
    triples: Triple[],
    episode: EpisodicNode,
  ): Promise<{
    resolvedStatements: Triple[];
    invalidatedStatements: string[];
  }> {
    const resolvedStatements: Triple[] = [];
    const invalidatedStatements: string[] = [];

    if (triples.length === 0) {
      return { resolvedStatements, invalidatedStatements };
    }

    // Step 1: Collect all potential matches for all triples at once
    const allPotentialMatches: Map<string, StatementNode[]> = new Map();
    const allExistingTripleData: Map<string, Triple> = new Map();

    // For preparing the LLM context
    const newStatements: any[] = [];
    const similarStatements: any[] = [];

    for (const triple of triples) {
      // Track IDs of statements we've already checked to avoid duplicates
      const checkedStatementIds: string[] = [];
      let potentialMatches: StatementNode[] = [];

      // Phase 1: Find statements with exact subject-predicate match
      const exactMatches = await findContradictoryStatements({
        subjectId: triple.subject.uuid,
        predicateId: triple.predicate.uuid,
      });

      if (exactMatches && exactMatches.length > 0) {
        potentialMatches.push(...exactMatches);
        checkedStatementIds.push(...exactMatches.map((s) => s.uuid));
      }

      // Phase 2: Find semantically similar statements
      const semanticMatches = await findSimilarStatements({
        factEmbedding: triple.statement.factEmbedding,
        threshold: 0.85,
        excludeIds: checkedStatementIds,
      });

      if (semanticMatches && semanticMatches.length > 0) {
        potentialMatches.push(...semanticMatches);
      }

      if (potentialMatches.length > 0) {
        logger.info(
          `Found ${potentialMatches.length} potential matches for: ${triple.statement.fact}`,
        );
        allPotentialMatches.set(triple.statement.uuid, potentialMatches);

        // Get full triple information for each potential match
        for (const match of potentialMatches) {
          if (!allExistingTripleData.has(match.uuid)) {
            const existingTripleData = await getTripleForStatement({
              statementId: match.uuid,
            });

            if (existingTripleData) {
              allExistingTripleData.set(match.uuid, existingTripleData);

              // Add to similarStatements for LLM context
              similarStatements.push({
                statementId: match.uuid,
                fact: existingTripleData.statement.fact,
                subject: existingTripleData.subject.name,
                predicate: existingTripleData.predicate.name,
                object: existingTripleData.object.name,
              });
            }
          }
        }
      }

      // Add to newStatements for LLM context
      newStatements.push({
        statement: {
          uuid: triple.statement.uuid,
          fact: triple.statement.fact,
        },
        subject: triple.subject.name,
        predicate: triple.predicate.name,
        object: triple.object.name,
      });
    }

    // Step 2: If we have potential matches, use the LLM to analyze them in batch
    if (similarStatements.length > 0) {
      // Prepare context for the LLM
      const promptContext = {
        newStatements,
        similarStatements,
        episodeContent: episode.content,
        referenceTime: episode.validAt.toISOString(),
      };

      // Get the statement resolution prompt
      const messages = resolveStatementPrompt(promptContext);

      let responseText = "";

      // Call the LLM to analyze all statements at once
      await makeModelCall(false, LLMModelEnum.GPT41, messages, (text) => {
        responseText = text;
      });

      try {
        // Extract the JSON response from the output tags
        const jsonMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
        const analysisResult = jsonMatch ? JSON.parse(jsonMatch[1]) : [];

        // Process the analysis results
        for (const result of analysisResult) {
          const tripleIndex = triples.findIndex(
            (t) => t.statement.uuid === result.statementId,
          );
          if (tripleIndex === -1) continue;

          const triple = triples[tripleIndex];

          // Handle duplicates
          if (result.isDuplicate && result.duplicateId) {
            const duplicateTriple = allExistingTripleData.get(
              result.duplicateId,
            );
            if (duplicateTriple) {
              logger.info(`Statement is a duplicate: ${triple.statement.fact}`);
              resolvedStatements.push(duplicateTriple);
              continue;
            }
          }

          // Handle contradictions
          if (result.contradictions && result.contradictions.length > 0) {
            for (const contradictionId of result.contradictions) {
              const contradictedTriple =
                allExistingTripleData.get(contradictionId);
              if (contradictedTriple) {
                invalidatedStatements.push(contradictedTriple.statement.uuid);
              }
            }
          }

          // Add the new statement if it's not a duplicate
          if (!result.isDuplicate) {
            logger.info(`Adding new statement: ${triple.statement.fact}`);
            resolvedStatements.push(triple);
          }
        }
      } catch (e) {
        logger.error("Error processing batch analysis:", { error: e });

        // Fallback: add all statements as new if we couldn't process the analysis
        for (const triple of triples) {
          if (
            !resolvedStatements.some(
              (s) => s.statement.uuid === triple.statement.uuid,
            )
          ) {
            logger.info(
              `Fallback: Adding statement as new: ${triple.statement.fact}`,
            );
            resolvedStatements.push(triple);
          }
        }
      }
    } else {
      // No potential matches found for any statements, add them all as new
      for (const triple of triples) {
        logger.info(
          `No matches found, adding as new: ${triple.statement.fact}`,
        );
        resolvedStatements.push(triple);
      }
    }

    return { resolvedStatements, invalidatedStatements };
  }

  /**
   * Normalize an episode by extracting entities and creating nodes and statements
   */
  private async normalizeEpisodeBody(episodeBody: string, source: string) {
    let appEnumValues: Apps[] = [];
    if (Apps[source.toUpperCase() as keyof typeof Apps]) {
      appEnumValues = [Apps[source.toUpperCase() as keyof typeof Apps]];
    }
    const entityTypes = getNodeTypesString(appEnumValues);

    const context = {
      episodeContent: episodeBody,
      entityTypes: entityTypes,
      source,
    };
    const messages = normalizePrompt(context);
    let responseText = "";
    await makeModelCall(false, LLMModelEnum.GPT41, messages, (text) => {
      responseText = text;
    });
    let normalizedEpisodeBody = "";
    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      normalizedEpisodeBody = outputMatch[1].trim();
    } else {
      normalizedEpisodeBody = episodeBody;
    }

    return normalizedEpisodeBody;
  }
}
