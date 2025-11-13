import { runQuery } from "~/lib/neo4j.server";
import {
  type StatementNode,
  type EntityNode,
  type EpisodicNode,
  EPISODIC_NODE_PROPERTIES,
  ENTITY_NODE_PROPERTIES,
  STATEMENT_NODE_PROPERTIES,
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
      e.labels = $labels,
      e.space = $space,
      e.sessionId = $sessionId,
      e.documentId = $documentId
    ON MATCH SET
      e.content = $content,
      e.contentEmbedding = $contentEmbedding,
      e.originalContent = $originalContent,
      e.metadata = $metadata,
      e.source = $source,
      e.validAt = $validAt,
      e.labels = $labels,
      e.space = $space,
      e.sessionId = $sessionId,
      e.documentId = $documentId
    RETURN e.uuid as uuid
  `;

  const params = {
    uuid: episode.uuid,
    content: episode.content,
    originalContent: episode.originalContent,
    source: episode.source,
    metadata: JSON.stringify(episode.metadata || {}),
    userId: episode.userId || null,
    labels: episode.labels || [],
    createdAt: episode.createdAt.toISOString(),
    validAt: episode.validAt.toISOString(),
    contentEmbedding: episode.contentEmbedding || [],
    space: episode.space || null,
    sessionId: episode.sessionId || null,
    documentId: episode.documentId || null,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

// Get an episode by UUID
export async function getEpisode(uuid: string): Promise<EpisodicNode | null> {
  const query = `
    MATCH (e:Episode {uuid: $uuid})
    RETURN e
  `;

  const result = await runQuery(query, { uuid });
  if (result.length === 0) return null;

  const episode = result[0].get("e").properties;
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
    MATCH (e)-[:HAS_PROVENANCE]->(s:Statement)
    WHERE s.invalidAt IS NULL
    RETURN DISTINCT ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY episode.validAt DESC
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
  WHERE episode.contentEmbedding IS NOT NULL
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

// Delete episode and its related nodes safely
export async function deleteEpisodeWithRelatedNodes(params: {
  episodeUuid: string;
  userId: string;
}): Promise<{
  episodeDeleted: boolean;
  statementsDeleted: number;
  entitiesDeleted: number;
  factsDeleted: number;
}> {
  // Step 1: Check if episode exists
  const episodeCheck = await runQuery(
    `MATCH (e:Episode {uuid: $episodeUuid, userId: $userId}) RETURN ${EPISODIC_NODE_PROPERTIES} as episode`,
    { episodeUuid: params.episodeUuid, userId: params.userId },
  );

  if (!episodeCheck || episodeCheck.length === 0) {
    return {
      // Return true if no episode exist
      episodeDeleted: true,
      statementsDeleted: 0,
      entitiesDeleted: 0,
      factsDeleted: 0,
    };
  }

  // Step 2: Find statements that are ONLY connected to this episode
  const statementsToDelete = await runQuery(
    `
    MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})-[:HAS_PROVENANCE]->(stmt:Statement)
    WHERE NOT EXISTS {
      MATCH (otherEpisode:Episode)-[:HAS_PROVENANCE]->(stmt)
      WHERE otherEpisode.uuid <> $episodeUuid AND otherEpisode.userId = $userId
    }
    RETURN stmt.uuid as statementUuid
  `,
    { episodeUuid: params.episodeUuid, userId: params.userId },
  );

  const statementUuids = statementsToDelete.map((r) => r.get("statementUuid"));

  // Step 3: Find entities that are ONLY connected to statements we're deleting
  const entitiesToDelete = await runQuery(
    `
    MATCH (stmt:Statement)-[r:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)
    WHERE stmt.uuid IN $statementUuids AND stmt.userId = $userId
    AND NOT EXISTS {
      MATCH (otherStmt:Statement)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity)
      WHERE otherStmt.userId = $userId AND NOT otherStmt.uuid IN $statementUuids
    }
    RETURN DISTINCT entity.uuid as entityUuid
  `,
    { statementUuids, userId: params.userId },
  );

  const entityUuids = entitiesToDelete.map((r) => r.get("entityUuid"));

  // Step 4: Delete statements
  if (statementUuids.length > 0) {
    await runQuery(
      `
      MATCH (stmt:Statement {userId: $userId})
      WHERE stmt.uuid IN $statementUuids
      DETACH DELETE stmt
    `,
      { statementUuids, userId: params.userId },
    );
  }

  // Step 5: Delete orphaned entities
  if (entityUuids.length > 0) {
    await runQuery(
      `
      MATCH (entity:Entity {userId: $userId})
      WHERE entity.uuid IN $entityUuids
      DETACH DELETE entity
    `,
      { entityUuids, userId: params.userId },
    );
  }

  // Step 6: Delete the episode
  await runQuery(
    `
    MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})
    DETACH DELETE episode
  `,
    { episodeUuid: params.episodeUuid, userId: params.userId },
  );

  return {
    episodeDeleted: true,
    statementsDeleted: statementUuids.length,
    entitiesDeleted: entityUuids.length,
    factsDeleted: statementUuids.length,
  };
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
  WHERE episode.contentEmbedding IS NOT NULL
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
    labels: raw.labels || [],
    space: raw.space || undefined,
    sessionId: raw.sessionId || undefined,
    recallCount: raw.recallCount || undefined,
    chunkIndex: raw.chunkIndex || undefined,
    labelIds: raw.labelIds || [],
  };
}
