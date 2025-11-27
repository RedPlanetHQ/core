import { runQuery } from "~/lib/neo4j.server";
import {
  type StatementNode,
  type EntityNode,
  type EpisodicNode,
  EPISODIC_NODE_PROPERTIES,
  ENTITY_NODE_PROPERTIES,
  STATEMENT_NODE_PROPERTIES,
  Triple,
} from "@core/types";
import { parseEntityNode } from "./entity";

export async function saveEpisode(episode: EpisodicNode): Promise<string> {
  const query = `
    MERGE (e:Episode {uuid: $uuid})
    ON CREATE SET
      e.content = $content,
      e.originalContent = $originalContent,
      e.contentEmbedding = $contentEmbedding,
      e.metadata = $metadata,
      e.source = $source,
      e.createdAt = $createdAt,
      e.validAt = $validAt,
      e.userId = $userId,
      e.labelIds = $labelIds,
      e.sessionId = $sessionId,
      e.queueId = $queueId,
      e.type = $type,
      e.chunkIndex = $chunkIndex,
      e.totalChunks = $totalChunks,
      e.version = $version,
      e.contentHash = $contentHash,
      e.previousVersionSessionId = $previousVersionSessionId,
      e.chunkHashes = $chunkHashes,
      e.queueId = $queueId
    ON MATCH SET
      e.content = $content,
      e.contentEmbedding = $contentEmbedding,
      e.originalContent = $originalContent,
      e.metadata = $metadata,
      e.source = $source,
      e.validAt = $validAt,
      e.labelIds = $labelIds,
      e.sessionId = $sessionId,
      e.queueId = $queueId,
      e.type = $type,
      e.chunkIndex = $chunkIndex,
      e.totalChunks = $totalChunks,
      e.version = $version,
      e.contentHash = $contentHash,
      e.previousVersionSessionId = $previousVersionSessionId,
      e.chunkHashes = $chunkHashes,
      e.queueId = $queueId
    RETURN e.uuid as uuid
  `;

  const params = {
    uuid: episode.uuid,
    content: episode.content,
    originalContent: episode.originalContent,
    source: episode.source,
    metadata: JSON.stringify(episode.metadata || {}),
    userId: episode.userId || null,
    labelIds: episode.labelIds || [],
    createdAt: episode.createdAt.toISOString(),
    validAt: episode.validAt.toISOString(),
    contentEmbedding: episode.contentEmbedding || [],
    sessionId: episode.sessionId,
    queueId: episode.queueId || null,
    type: episode.type || null,
    chunkIndex: episode.chunkIndex !== undefined ? episode.chunkIndex : null,
    totalChunks: episode.totalChunks || null,
    version: episode.version || null,
    contentHash: episode.contentHash || null,
    previousVersionSessionId: episode.previousVersionSessionId || null,
    chunkHashes: episode.chunkHashes || [],
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

// Get an episode by UUID
export async function getEpisode(
  uuid: string,
  withEmbedding: boolean = false,
): Promise<EpisodicNode | null> {
  const query = `
    MATCH (e:Episode {uuid: $uuid})
    RETURN ${withEmbedding ? `${EPISODIC_NODE_PROPERTIES}, e.contentEmbedding as contentEmbedding` : EPISODIC_NODE_PROPERTIES} as episode
  `;

  const result = await runQuery(query, { uuid });
  if (result.length === 0) return null;

  const episode = result[0].get("episode");
  return parseEpisodicNode(episode);
}

// Get recent episodes with optional filters
export async function getRecentEpisodes(params: {
  referenceTime: Date;
  limit: number;
  userId: string;
  source?: string;
  sessionId?: string;
}): Promise<EpisodicNode[]> {
  let filters = `WHERE e.validAt <= $referenceTime`;

  if (params.source) {
    filters += `\nAND e.source = $source`;
  }

  if (params.sessionId) {
    filters += `\nAND e.sessionId = $sessionId`;
  }

  const query = `
    MATCH (e:Episode{userId: $userId})
    ${filters}
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY e.validAt DESC
    LIMIT ${params.limit}
  `;

  const queryParams = {
    referenceTime: new Date(params.referenceTime).toISOString(),
    userId: params.userId,
    source: params.source || null,
    sessionId: params.sessionId || null,
  };

  const result = await runQuery(query, queryParams);

  return result.map((record) => {
    try {
      const episode = record.get("episode");
      return parseEpisodicNode(episode);
    } catch (error) {
      console.error("Error parsing episode:", error);
      return {} as EpisodicNode;
    }
  });
}

// Get all episodes for a session ordered by createdAt
export async function getEpisodesBySession(params: {
  sessionId: string;
  userId: string;
}): Promise<EpisodicNode[]> {
  const query = `
    MATCH (e:Episode {userId: $userId, sessionId: $sessionId})
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY e.createdAt ASC
  `;

  const result = await runQuery(query, {
    userId: params.userId,
    sessionId: params.sessionId,
  });

  return result.map((record) => {
    return parseEpisodicNode(record.get("episode"));
  });
}

export async function searchEpisodesByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
}) {
  const limit = params.limit || 100;
  const query = `
  MATCH (episode:Episode{userId: $userId})
  WHERE episode.contentEmbedding IS NOT NULL and size(episode.contentEmbedding) > 0
  WITH episode, gds.similarity.cosine(episode.contentEmbedding, $embedding) AS score
  WHERE score >= $minSimilarity
  RETURN ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "episode.")} as episode, score
  ORDER BY score DESC
  LIMIT ${limit}`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    userId: params.userId,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    return parseEpisodicNode(record.get("episode"));
  });
}

// Delete episode and its related nodes safely using single optimized Cypher
export async function deleteEpisodeWithRelatedNodes(params: {
  episodeUuid: string;
  userId: string;
}): Promise<{
  deleted: boolean;
  episodesDeleted: number;
  statementsDeleted: number;
  entitiesDeleted: number;
}> {
  // Check if episode exists
  const episodeCheck = await runQuery(
    `MATCH (e:Episode {uuid: $episodeUuid, userId: $userId}) RETURN e.uuid as uuid`,
    { episodeUuid: params.episodeUuid, userId: params.userId },
  );

  if (!episodeCheck || episodeCheck.length === 0) {
    return {
      deleted: true,
      episodesDeleted: 0,
      statementsDeleted: 0,
      entitiesDeleted: 0,
    };
  }

  const query = `
    MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})

    // Get all related data first
    OPTIONAL MATCH (episode)-[:HAS_PROVENANCE]->(s:Statement)
    OPTIONAL MATCH (s)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)

    // Collect all related nodes
    WITH episode, collect(DISTINCT s) as statements, collect(DISTINCT entity) as entities

    // Find statements only connected to this episode
    UNWIND CASE WHEN size(statements) = 0 THEN [null] ELSE statements END as stmt
    OPTIONAL MATCH (otherEpisode:Episode)-[:HAS_PROVENANCE]->(stmt)
    WHERE stmt IS NOT NULL AND otherEpisode.uuid <> $episodeUuid AND otherEpisode.userId = $userId

    WITH episode, statements, entities,
         collect(CASE WHEN stmt IS NOT NULL AND otherEpisode IS NULL THEN stmt ELSE null END) as orphanedStatements

    // Filter to valid orphaned statements
    WITH episode, statements, entities, [s IN orphanedStatements WHERE s IS NOT NULL] as stmtsToDelete

    // Find orphaned entities (only connected to statements we're deleting)
    UNWIND CASE WHEN size(entities) = 0 THEN [null] ELSE entities END as entity
    OPTIONAL MATCH (entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(otherStmt:Statement)
    WHERE entity IS NOT NULL AND NOT otherStmt IN stmtsToDelete

    WITH episode, stmtsToDelete,
         collect(CASE WHEN entity IS NOT NULL AND otherStmt IS NULL THEN entity ELSE null END) as orphanedEntities

    // Delete orphaned statements
    FOREACH (stmt IN stmtsToDelete | DETACH DELETE stmt)

    // Delete orphaned entities only
    WITH episode, stmtsToDelete, [entity IN orphanedEntities WHERE entity IS NOT NULL] as entitiesToDelete
    FOREACH (entity IN entitiesToDelete | DETACH DELETE entity)

    // Delete episode
    DETACH DELETE episode

    RETURN
      true as deleted,
      1 as episodesDeleted,
      size(stmtsToDelete) as statementsDeleted,
      size(entitiesToDelete) as entitiesDeleted
  `;

  try {
    const result = await runQuery(query, {
      episodeUuid: params.episodeUuid,
      userId: params.userId,
    });

    if (result.length === 0) {
      return {
        deleted: false,
        episodesDeleted: 0,
        statementsDeleted: 0,
        entitiesDeleted: 0,
      };
    }

    const record = result[0];
    return {
      deleted: record.get("deleted") || false,
      episodesDeleted: record.get("episodesDeleted") || 0,
      statementsDeleted: record.get("statementsDeleted") || 0,
      entitiesDeleted: record.get("entitiesDeleted") || 0,
    };
  } catch (error) {
    console.error("Error deleting episode with related nodes:", error);
    throw error;
  }
}

export async function getRelatedEpisodesEntities(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
}) {
  const limit = params.limit || 100;
  const query = `
  MATCH (episode:Episode{userId: $userId})
  WHERE episode.contentEmbedding IS NOT NULL and size(episode.contentEmbedding) > 0
  WITH episode, gds.similarity.cosine(episode.contentEmbedding, $embedding) AS score
  WHERE score >= $minSimilarity
  OPTIONAL MATCH (episode)-[:HAS_PROVENANCE]->(stmt:Statement)-[:HAS_SUBJECT|HAS_OBJECT]->(ent:Entity)
  WHERE ent IS NOT NULL
  RETURN DISTINCT ${ENTITY_NODE_PROPERTIES} as entity
  LIMIT ${limit}`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    userId: params.userId,
  });

  return result
    .map((record) => {
      return parseEntityNode(record.get("entity"));
    })
    .filter((entity): entity is EntityNode => entity !== null);
}

export async function getEpisodeStatements(params: {
  episodeUuid: string;
  userId: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  const query = `
  MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})-[:HAS_PROVENANCE]->(s:Statement)
  WHERE s.invalidAt IS NULL
  RETURN ${STATEMENT_NODE_PROPERTIES} as statement
  `;

  const result = await runQuery(query, {
    episodeUuid: params.episodeUuid,
    userId: params.userId,
  });

  return result.map((record) => {
    const statement = record.get("statement");

    return {
      uuid: statement.uuid,
      fact: statement.fact,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      attributes: statement.attributes ? JSON.parse(statement.attributes) : {},
      userId: statement.userId,
    };
  });
}

export async function getStatementsInvalidatedByEpisode(params: {
  episodeUuid: string;
  userId: string;
}) {
  const query = `
  MATCH (s:Statement {invalidatedBy: $episodeUuid})
  RETURN ${STATEMENT_NODE_PROPERTIES} as statement
  `;

  const result = await runQuery(query, {
    episodeUuid: params.episodeUuid,
  });

  return result.map((record) => {
    const statement = record.get("statement");
    return {
      uuid: statement.uuid,
      fact: statement.fact,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      attributes: statement.attributes ? JSON.parse(statement.attributes) : {},
      userId: statement.userId,
    };
  });
}

export async function getEpisodesByUserId(params: {
  userId: string;
  startTime?: string;
  endTime?: string;
}): Promise<EpisodicNode[]> {
  let whereClause = "";
  const conditions: string[] = [];

  if (params.startTime) {
    conditions.push("e.createdAt >= datetime($startTime)");
  }
  if (params.endTime) {
    conditions.push("e.createdAt <= datetime($endTime)");
  }

  if (conditions.length > 0) {
    whereClause = `WHERE ${conditions.join(" AND ")}`;
  }

  const query = `
  MATCH (e:Episode {userId: $userId})
  ${whereClause}
  RETURN ${EPISODIC_NODE_PROPERTIES} as episode
  `;

  const result = await runQuery(query, {
    userId: params.userId,
    startTime: params.startTime,
    endTime: params.endTime,
  });

  return result.map((record) => record.get("episode") as EpisodicNode);
}

export function parseEpisodicNode(raw: any): EpisodicNode {
  return {
    uuid: raw.uuid,
    content: raw.content,
    contentEmbedding: raw.contentEmbedding || [],
    originalContent: raw.originalContent,
    source: raw.source,
    metadata: raw.metadata ? JSON.parse(raw.metadata) : {},
    createdAt: new Date(raw.createdAt),
    validAt: new Date(raw.validAt),
    userId: raw.userId,
    labelIds: raw.labelIds || [],
    sessionId: raw.sessionId || undefined,
    recallCount: raw.recallCount || undefined,
    chunkIndex: raw.chunkIndex || undefined,
    queueId: raw.queueId || undefined,
  };
}

export async function addLabelToEpisodes(
  labelId: string,
  episodeUuids: string[],
  userId: string,
): Promise<number> {
  const query = `
    MATCH (e:Episode {userId: $userId})
    WHERE e.uuid IN $episodeUuids AND NOT $labelId IN COALESCE(e.labelIds, [])
    SET e.labelIds = COALESCE(e.labelIds, []) + $labelId
    RETURN count(e) as updatedEpisodes
  `;

  const result = await runQuery(query, {
    userId,
    episodeUuids,
    labelId,
  });
  const updatedEpisodes = result[0]?.get("updatedEpisodes") || 0;

  return updatedEpisodes;
}

export async function updateEpisodeLabels(
  episodeUuids: string[],
  labelIds: string[],
  userId: string,
): Promise<number> {
  if (episodeUuids.length === 0) return 0;

  const query = `
    MATCH (e:Episode {userId: $userId})
    WHERE e.uuid IN $episodeUuids
    SET e.labelIds = $labelIds
    RETURN count(e) as updatedEpisodes
  `;

  const result = await runQuery(query, {
    userId,
    episodeUuids,
    labelIds,
  });

  return result[0]?.get("updatedEpisodes") || 0;
}

export async function getSessionEpisodes(
  sessionId: string,
  userId: string,
  limit?: number,
): Promise<EpisodicNode[]> {
  const query = `
    MATCH (e:Episode {userId: $userId})
    WHERE e.sessionId = $sessionId
    ORDER BY e.createdAt ${limit ? "DESC" : "ASC"}
    ${limit ? `LIMIT ${limit}` : ""}
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
  `;

  const result = await runQuery(query, {
    sessionId,
    userId,
  });

  return result.map((record) => parseEpisodicNode(record.get("episode")));
}

export async function getTriplesForEpisode(
  episodeUuid: string,
  userId: string,
): Promise<Triple[]> {
  const query = `
    MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})-[:HAS_PROVENANCE]->(statement:Statement)
    MATCH (statement)-[:HAS_SUBJECT]->(subject:Entity)
    MATCH (statement)-[:HAS_PREDICATE]->(predicate:Entity)
    MATCH (statement)-[:HAS_OBJECT]->(object:Entity)
    RETURN
      statement {
        .uuid, .fact, .factEmbedding, .createdAt, .validAt, .invalidAt, .invalidatedBy, .attributes, .userId
      } as statement,
      subject {
        .uuid, .name, .type, .attributes, .nameEmbedding, .createdAt, .userId
      } as subject,
      predicate {
        .uuid, .name, .type, .attributes, .nameEmbedding, .createdAt, .userId
      } as predicate,
      object {
        .uuid, .name, .type, .attributes, .nameEmbedding, .createdAt, .userId
      } as object,
      episode {
        .uuid, .content, .originalContent, .source, .metadata, .createdAt, .validAt, .labelIds, .userId, .sessionId
      } as episode
  `;

  const result = await runQuery(query, { episodeUuid, userId });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    const statementProps = record.get("statement");
    const subjectProps = record.get("subject");
    const predicateProps = record.get("predicate");
    const objectProps = record.get("object");
    const episodeProps = record.get("episode");

    return {
      statement: {
        uuid: statementProps.uuid,
        fact: statementProps.fact,
        factEmbedding: statementProps.factEmbedding || [],
        createdAt: new Date(statementProps.createdAt),
        validAt: new Date(statementProps.validAt),
        invalidAt: statementProps.invalidAt
          ? new Date(statementProps.invalidAt)
          : null,
        invalidatedBy: statementProps.invalidatedBy,
        attributes: statementProps.attributes
          ? JSON.parse(statementProps.attributes)
          : {},
        userId: statementProps.userId,
      },
      subject: {
        uuid: subjectProps.uuid,
        name: subjectProps.name,
        type: subjectProps.type,
        attributes: subjectProps.attributes
          ? JSON.parse(subjectProps.attributes)
          : {},
        nameEmbedding: subjectProps.nameEmbedding || [],
        createdAt: new Date(subjectProps.createdAt),
        userId: subjectProps.userId,
      },
      predicate: {
        uuid: predicateProps.uuid,
        name: predicateProps.name,
        type: predicateProps.type,
        attributes: predicateProps.attributes
          ? JSON.parse(predicateProps.attributes)
          : {},
        nameEmbedding: predicateProps.nameEmbedding || [],
        createdAt: new Date(predicateProps.createdAt),
        userId: predicateProps.userId,
      },
      object: {
        uuid: objectProps.uuid,
        name: objectProps.name,
        type: objectProps.type,
        attributes: objectProps.attributes
          ? JSON.parse(objectProps.attributes)
          : {},
        nameEmbedding: objectProps.nameEmbedding || [],
        createdAt: new Date(objectProps.createdAt),
        userId: objectProps.userId,
      },
      provenance: {
        uuid: episodeProps.uuid,
        content: episodeProps.content,
        originalContent: episodeProps.originalContent,
        contentEmbedding: [],
        source: episodeProps.source,
        metadata: episodeProps.metadata || {},
        createdAt: new Date(episodeProps.createdAt),
        validAt: new Date(episodeProps.validAt),
        labelIds: episodeProps.labelIds || [],
        userId: episodeProps.userId,
        sessionId: episodeProps.sessionId,
      },
    };
  });
}

/**
 * Link an episode to an existing statement (for duplicate handling)
 */
export async function linkEpisodeToExistingStatement(
  episodeUuid: string,
  statementUuid: string,
  userId: string,
): Promise<void> {
  await runQuery(
    `
    MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})
    MATCH (statement:Statement {uuid: $statementUuid, userId: $userId})
    MERGE (episode)-[r:HAS_PROVENANCE]->(statement)
    ON CREATE SET r.uuid = randomUUID(), r.createdAt = datetime(), r.userId = $userId
  `,
    { episodeUuid, statementUuid, userId },
  );
}

/**
 * Move all provenance relationships from source statement to target statement
 * Used when consolidating duplicate statements - moves ALL episode links, not just one
 */
export async function moveAllProvenanceToStatement(
  sourceStatementUuid: string,
  targetStatementUuid: string,
  userId: string,
): Promise<number> {
  const result = await runQuery(
    `
    MATCH (source:Statement {uuid: $sourceStatementUuid, userId: $userId})
    MATCH (target:Statement {uuid: $targetStatementUuid, userId: $userId})

    // Find all episodes linked to source
    OPTIONAL MATCH (episode:Episode)-[r:HAS_PROVENANCE]->(source)
    WITH source, target, collect(episode) AS episodes, collect(r) AS rels

    // Delete old relationships
    FOREACH (r IN rels | DELETE r)

    // Create new relationships to target (MERGE to avoid duplicates)
    FOREACH (ep IN episodes | MERGE (ep)-[newR:HAS_PROVENANCE]->(target)
      ON CREATE SET newR.uuid = randomUUID(), newR.createdAt = datetime(), newR.userId = $userId)

    RETURN size(episodes) AS movedCount
  `,
    { sourceStatementUuid, targetStatementUuid, userId },
  );

  const count = result[0]?.get("movedCount");
  return count ? Number(count) : 0;
}

/**
 * Get all sessions for a user (replaces getUserDocuments)
 * Returns first episode of each session for session-level metadata
 * @param userId - User ID
 * @param type - Optional filter by episode type (CONVERSATION or DOCUMENT)
 * @param limit - Optional limit on number of sessions
 */
export async function getUserSessions(
  userId: string,
  type?: string,
  limit: number = 50,
): Promise<EpisodicNode[]> {
  const typeFilter = type ? `AND e.type = $type` : "";

  const query = `
    MATCH (e:Episode {userId: $userId})
    WHERE e.chunkIndex = 0 ${typeFilter}
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY e.createdAt DESC
    LIMIT ${limit}
  `;

  const result = await runQuery(query, { userId, type });

  return result.map((record) => parseEpisodicNode(record.get("episode")));
}

/**
 * Invalidate all statements from a previous document version
 * Marks statements as invalid but keeps episodes for version history
 * Optionally filter by specific chunk indices for differential invalidation
 */
export async function invalidateStatementsFromPreviousVersion(params: {
  sessionId: string;
  userId: string;
  previousVersion: number;
  invalidatedBy: string;
  invalidatedAt?: Date;
  changedChunkIndices?: number[]; // Optional: only invalidate statements from specific chunks
}): Promise<{
  invalidatedCount: number;
  statementUuids: string[];
}> {
  const invalidatedAt = params.invalidatedAt || new Date();

  // Build chunk filter if provided
  const chunkFilter =
    params.changedChunkIndices && params.changedChunkIndices.length > 0
      ? `AND e.chunkIndex IN $changedChunkIndices`
      : "";

  const query = `
    MATCH (e:Episode {sessionId: $sessionId, userId: $userId, version: $previousVersion})-[:HAS_PROVENANCE]->(s:Statement)
    WHERE s.invalidAt IS NULL ${chunkFilter}
    SET s.invalidAt = $invalidatedAt,
        s.invalidatedBy = $invalidatedBy
    RETURN collect(s.uuid) as statementUuids, count(s) as invalidatedCount
  `;

  const result = await runQuery(query, {
    sessionId: params.sessionId,
    userId: params.userId,
    previousVersion: params.previousVersion,
    invalidatedBy: params.invalidatedBy,
    invalidatedAt: invalidatedAt.toISOString(),
    changedChunkIndices: params.changedChunkIndices || [],
  });

  if (result.length === 0) {
    return {
      invalidatedCount: 0,
      statementUuids: [],
    };
  }

  const record = result[0];
  return {
    invalidatedCount: record.get("invalidatedCount") || 0,
    statementUuids: record.get("statementUuids") || [],
  };
}
