import { type CoreMessage } from "ai";
import {
  type ExtractedTripleData,
  type AddEpisodeParams,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
} from "@core/types";
import { logger } from "./logger.service";
import crypto from "crypto";
import {
  dedupeNodes,
  extractAttributes,
  extractMessage,
  extractText,
} from "./prompts/nodes";
import {
  extractStatements,
  resolveStatementPrompt,
} from "./prompts/statements";
import {
  getRecentEpisodes,
  getRelatedEpisodesEntities,
  searchEpisodesByEmbedding,
} from "./graphModels/episode";
import {
  findExactPredicateMatches,
  findSimilarEntities,
  findSimilarEntitiesWithSameType,
  replaceEntityReferences,
} from "./graphModels/entity";
import {
  findContradictoryStatements,
  findSimilarStatements,
  getTripleForStatement,
  invalidateStatements,
  saveTriple,
  searchStatementsByEmbedding,
} from "./graphModels/statement";
import { getEmbedding, makeModelCall } from "~/lib/model.server";
import {
  Apps,
  getNodeTypes,
  getNodeTypesString,
  isPresetType,
  getAllPresetTypes,
} from "~/utils/presets/nodes";
import { normalizePrompt } from "./prompts";

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
        sessionId: params.sessionId,
      });

      const normalizedEpisodeBody = await this.normalizeEpisodeBody(
        params.episodeBody,
        params.source,
        params.userId,
      );

      const relatedEpisodesEntities = await getRelatedEpisodesEntities({
        embedding: await this.getEmbedding(normalizedEpisodeBody),
        userId: params.userId,
        minSimilarity: 0.7,
      });

      if (normalizedEpisodeBody === "NOTHING_TO_REMEMBER") {
        logger.log("Nothing to remember");
        return;
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

      // Step 3.1: Context-aware entity resolution with preset type evolution
      await this.resolveEntitiesWithContext(
        extractedNodes,
        relatedEpisodesEntities,
      );

      // Step 3.2: Handle preset type logic - expand entities for statement extraction
      const entitiesForStatementExtraction =
        await this.expandEntitiesForStatements(extractedNodes, episode);

      // Step 4: Statement Extraction - Extract statements (triples) instead of direct edges
      const extractedStatements = await this.extractStatements(
        episode,
        entitiesForStatementExtraction,
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

      // Step 7: ADd attributes to entity nodes
      const updatedTriples = await this.addAttributesToEntities(
        resolvedStatements,
        episode,
      );

      for (const triple of updatedTriples) {
        const { subject, predicate, object, statement, provenance } = triple;
        const safeTriple = {
          subject: {
            ...subject,
            nameEmbedding: undefined,
            typeEmbedding: undefined,
          },
          predicate: {
            ...predicate,
            nameEmbedding: undefined,
            typeEmbedding: undefined,
          },
          object: {
            ...object,
            nameEmbedding: undefined,
            typeEmbedding: undefined,
          },
          statement: { ...statement, factEmbedding: undefined },
          provenance: { ...provenance, contentEmbedding: undefined },
        };
      }

      // Save triples sequentially to avoid parallel processing issues
      for (const triple of updatedTriples) {
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
    const messages = episode.sessionId
      ? extractMessage(context)
      : extractText(context);

    let responseText = "";

    await makeModelCall(false, messages as CoreMessage[], (text) => {
      responseText = text;
    });

    // Convert to EntityNode objects
    let entities: EntityNode[] = [];

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
      const extractedEntities = JSON.parse(responseText || "{}").entities || [];

      entities = await Promise.all(
        extractedEntities.map(async (entity: any) => ({
          uuid: crypto.randomUUID(),
          name: entity.name,
          type: entity.type,
          attributes: entity.attributes || {},
          nameEmbedding: await this.getEmbedding(entity.name),
          typeEmbedding: await this.getEmbedding(entity.type),
          createdAt: new Date(),
          userId: episode.userId,
        })),
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
    await makeModelCall(false, messages as CoreMessage[], (text) => {
      responseText = text;
    });

    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      responseText = outputMatch[1].trim();
    } else {
      responseText = "{}";
    }

    // Parse the statements from the LLM response
    const extractedTriples: ExtractedTripleData[] =
      JSON.parse(responseText || "{}").edges || [];

    // Create maps to deduplicate entities by name within this extraction
    const predicateMap = new Map<string, EntityNode>();

    // First pass: collect all unique predicates from the current extraction
    for (const triple of extractedTriples) {
      const predicateName = triple.predicate.toLowerCase();
      if (!predicateMap.has(predicateName)) {
        // Create new predicate
        const newPredicate = {
          uuid: crypto.randomUUID(),
          name: triple.predicate,
          type: "Predicate",
          attributes: {},
          nameEmbedding: await this.getEmbedding(triple.predicate),
          typeEmbedding: await this.getEmbedding("Predicate"),
          createdAt: new Date(),
          userId: episode.userId,
        };
        predicateMap.set(predicateName, newPredicate);
      }
    }

    // Convert extracted triples to Triple objects with Statement nodes
    const triples = await Promise.all(
      extractedTriples.map(async (triple: ExtractedTripleData) => {
        // Find the subject and object nodes by matching both name and type
        const subjectNode = extractedEntities.find(
          (node) =>
            node.name.toLowerCase() === triple.source.toLowerCase() &&
            node.type.toLowerCase() === triple.sourceType.toLowerCase(),
        );

        const objectNode = extractedEntities.find(
          (node) =>
            node.name.toLowerCase() === triple.target.toLowerCase() &&
            node.type.toLowerCase() === triple.targetType.toLowerCase(),
        );

        // Get the deduplicated predicate node
        const predicateNode = predicateMap.get(triple.predicate.toLowerCase());

        if (subjectNode && objectNode && predicateNode) {
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
   * Expand entities for statement extraction by adding existing preset entities
   */
  private async expandEntitiesForStatements(
    extractedNodes: EntityNode[],
    episode: EpisodicNode,
  ): Promise<EntityNode[]> {
    const allAppEnumValues = Object.values(Apps);
    const expandedEntities = [...extractedNodes];

    // For each extracted entity, check if we need to add existing preset entities
    for (const entity of extractedNodes) {
      const newIsPreset = isPresetType(entity.type, allAppEnumValues);

      // Find similar entities with same name
      const similarEntities = await findSimilarEntities({
        queryEmbedding: entity.nameEmbedding,
        limit: 5,
        threshold: 0.7,
        userId: episode.userId,
      });

      for (const existingEntity of similarEntities) {
        const existingIsPreset = isPresetType(
          existingEntity.type,
          allAppEnumValues,
        );

        // If both are preset types, include both for statement extraction
        if (newIsPreset && existingIsPreset) {
          // Add the existing entity to the list if not already present
          if (!expandedEntities.some((e) => e.uuid === existingEntity.uuid)) {
            expandedEntities.push(existingEntity);
          }
        }
      }
    }

    return expandedEntities;
  }

  /**
   * Resolve entities with context-aware deduplication and preset type evolution
   * Only merges entities that appear in semantically related episodes
   */
  private async resolveEntitiesWithContext(
    extractedNodes: EntityNode[],
    relatedEpisodesEntities: EntityNode[],
  ): Promise<void> {
    const allAppEnumValues = Object.values(Apps);

    extractedNodes.map(async (newEntity) => {
      // Find same-name entities in related episodes (contextually relevant)
      const sameNameInContext = relatedEpisodesEntities.filter(
        (existing) =>
          existing.name.toLowerCase() === newEntity.name.toLowerCase(),
      );

      if (sameNameInContext.length > 0) {
        let existingEntityIds: string[] = [];
        sameNameInContext.forEach(async (existingEntity) => {
          const newIsPreset = isPresetType(newEntity.type, allAppEnumValues);
          const existingIsPreset = isPresetType(
            existingEntity.type,
            allAppEnumValues,
          );

          if (newIsPreset && !existingIsPreset) {
            // New is preset, existing is custom - evolve existing entity to preset type
            console.log(
              `Evolving entity: ${existingEntity.name} from ${existingEntity.type} to ${newEntity.type}`,
            );
            existingEntityIds.push(existingEntity.uuid);
          }
        });

        if (existingEntityIds.length > 0) {
          await replaceEntityReferences(newEntity, existingEntityIds);
        }
      }
    });
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

    // Separate predicates from other entities
    const predicates = uniqueEntities.filter(
      (entity) => entity.type === "Predicate",
    );
    const nonPredicates = uniqueEntities.filter(
      (entity) => entity.type !== "Predicate",
    );

    // Step 2a: Find similar entities for non-predicate entities
    const similarEntitiesResults = await Promise.all(
      nonPredicates.map(async (entity) => {
        const similarEntities = await findSimilarEntitiesWithSameType({
          queryEmbedding: entity.nameEmbedding,
          entityType: entity.type,
          limit: 5,
          threshold: 0.7,
          userId: episode.userId,
        });
        return {
          entity,
          similarEntities,
        };
      }),
    );

    // Step 2b: Find exact matches for predicates
    const exactPredicateResults = await Promise.all(
      predicates.map(async (predicate) => {
        const exactMatches = await findExactPredicateMatches({
          predicateName: predicate.name,
          userId: episode.userId,
        });

        // Filter out the current predicate from matches
        const filteredMatches = exactMatches.filter(
          (match) => match.uuid !== predicate.uuid,
        );

        return {
          entity: predicate,
          similarEntities: filteredMatches, // Use the same structure as similarEntitiesResults
        };
      }),
    );

    // Combine the results
    const allEntityResults = [
      ...similarEntitiesResults,
      ...exactPredicateResults,
    ];

    // Step 3: Prepare context for LLM deduplication
    const dedupeContext = {
      extracted_nodes: allEntityResults.map((result, index) => ({
        id: index,
        name: result.entity.name,
        entity_type: result.entity.type,
        duplication_candidates: result.similarEntities.map((candidate, j) => ({
          idx: j,
          name: candidate.name,
          entity_type: candidate.type,
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

    await makeModelCall(false, messages as CoreMessage[], (text) => {
      responseText = text;
    });

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
        const originalEntity = allEntityResults[resolution.id ?? index];
        if (!originalEntity) return;

        const duplicateIdx = resolution.duplicate_idx ?? -1;

        // Get the corresponding result from allEntityResults
        const resultEntry = allEntityResults.find(
          (result) => result.entity.uuid === originalEntity.entity.uuid,
        );

        if (!resultEntry) return;

        // If a duplicate was found, use that entity, otherwise keep original
        const resolvedEntity =
          duplicateIdx >= 0 && duplicateIdx < resultEntry.similarEntities.length
            ? resultEntry.similarEntities[duplicateIdx]
            : originalEntity.entity;

        // Update name if provided
        if (resolution.name) {
          resolvedEntity.name = resolution.name;
        }

        // Map original UUID to resolved entity
        entityResolutionMap.set(originalEntity.entity.uuid, resolvedEntity);
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
        userId: triple.provenance.userId,
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
        userId: triple.provenance.userId,
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
      await makeModelCall(false, messages, (text) => {
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
   * Add attributes to entity nodes based on the resolved statements
   */
  private async addAttributesToEntities(
    triples: Triple[],
    episode: EpisodicNode,
  ): Promise<Triple[]> {
    // Collect all unique entities from the triples
    const entityMap = new Map<string, EntityNode>();

    // Add all subjects, predicates, and objects to the map
    triples.forEach((triple) => {
      if (triple.subject) {
        entityMap.set(triple.subject.uuid, triple.subject);
      }
      if (triple.predicate) {
        entityMap.set(triple.predicate.uuid, triple.predicate);
      }
      if (triple.object) {
        entityMap.set(triple.object.uuid, triple.object);
      }
    });

    // Convert the map to an array of entities
    const entities = Array.from(entityMap.values());

    if (entities.length === 0) {
      return triples; // No entities to process
    }

    // Get all app keys
    const allAppEnumValues = Object.values(Apps);

    // Get all node types with their attribute definitions
    const entityTypes = getNodeTypes(allAppEnumValues);

    // Prepare simplified context for the LLM
    const context = {
      episodeContent: episode.content,
      entityTypes: entityTypes,
      entities: entities.map((entity) => ({
        uuid: entity.uuid,
        name: entity.name,
        type: entity.type,
        currentAttributes: entity.attributes || {},
      })),
    };

    // Create a prompt for the LLM to extract attributes
    const messages = extractAttributes(context);

    let responseText = "";

    // Call the LLM to extract attributes
    await makeModelCall(false, messages as CoreMessage[], (text) => {
      responseText = text;
    });

    try {
      const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
      if (outputMatch && outputMatch[1]) {
        responseText = outputMatch[1].trim();
      }
      // Parse the LLM response
      const responseData = JSON.parse(responseText);
      const updatedEntities = responseData.entities || [];

      // Update entity attributes and save them
      for (const updatedEntity of updatedEntities) {
        const entity = entityMap.get(updatedEntity.uuid);
        if (entity) {
          // Merge the existing attributes with the new ones
          entity.attributes = {
            ...updatedEntity.attributes,
          };
        }
      }

      logger.info(`Updated attributes for ${updatedEntities.length} entities`);
    } catch (error) {
      logger.error("Error processing entity attributes", { error });
    }

    return triples;
  }

  /**
   * Normalize an episode by extracting entities and creating nodes and statements
   */
  private async normalizeEpisodeBody(
    episodeBody: string,
    source: string,
    userId: string,
  ) {
    let appEnumValues: Apps[] = [];
    if (Apps[source.toUpperCase() as keyof typeof Apps]) {
      appEnumValues = [Apps[source.toUpperCase() as keyof typeof Apps]];
    }
    const entityTypes = getNodeTypesString(appEnumValues);
    const relatedMemories = await this.getRelatedMemories(episodeBody, userId);
    
    // Fetch ingestion rules for this source
    const ingestionRules = await this.getIngestionRulesForSource(source, userId);

    const context = {
      episodeContent: episodeBody,
      entityTypes: entityTypes,
      source,
      relatedMemories,
      ingestionRules,
    };
    const messages = normalizePrompt(context);
    let responseText = "";
    await makeModelCall(false, messages, (text) => {
      responseText = text;
    });
    let normalizedEpisodeBody = "";
    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      normalizedEpisodeBody = outputMatch[1].trim();
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
        relatedFacts.forEach((fact, index) => {
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
  ): Promise<string | null> {
    try {
      // Import prisma here to avoid circular dependencies
      const { prisma } = await import("~/db.server");

      // Get the user's workspace
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { Workspace: true },
      });

      if (!user?.Workspace) {
        return null;
      }

      // Fetch active rules for this source
      const rules = await prisma.ingestionRule.findMany({
        where: {
          source,
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
