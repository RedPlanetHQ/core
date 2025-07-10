import { runQuery } from "~/lib/neo4j.server";
import type { EntityNode, EpisodicNode } from "@core/types";

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
      e.sessionId = $sessionId
    ON MATCH SET
      e.content = $content,
      e.contentEmbedding = $contentEmbedding,
      e.originalContent = $originalContent,
      e.metadata = $metadata,
      e.source = $source,
      e.validAt = $validAt,
      e.labels = $labels,
      e.space = $space,
      e.sessionId = $sessionId
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
  return {
    uuid: episode.uuid,
    content: episode.content,
    originalContent: episode.originalContent,
    contentEmbedding: episode.contentEmbedding,
    metadata: JSON.parse(episode.metadata || "{}"),
    source: episode.source,
    createdAt: new Date(episode.createdAt),
    validAt: new Date(episode.validAt),
    labels: episode.labels,
    userId: episode.userId,
    space: episode.space,
    sessionId: episode.sessionId,
  };
}

// Get recent episodes with optional filters
export async function getRecentEpisodes(params: {
  referenceTime: Date;
  limit: number;
  userId: string;
  source?: string;
  sessionId?: string;
}): Promise<EpisodicNode[]> {
  let filters = `WHERE e.validAt <= $referenceTime
  AND e.userId = $userId`;

  if (params.source) {
    filters += `\nAND e.source = $source`;
  }

  if (params.sessionId) {
    filters += `\nAND e.sessionId = $sessionId`;
  }

  const query = `
    MATCH (e:Episode)
    ${filters}
    RETURN e
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
    const episode = record.get("e").properties;
    return {
      uuid: episode.uuid,
      content: episode.content,
      originalContent: episode.originalContent,
      contentEmbedding: episode.contentEmbedding,
      metadata: JSON.parse(episode.metadata || "{}"),
      source: episode.source,
      createdAt: new Date(episode.createdAt),
      validAt: new Date(episode.validAt),
      labels: episode.labels,
      userId: episode.userId,
      space: episode.space,
      sessionId: episode.sessionId,
    };
  });
}

export async function searchEpisodesByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
}) {
  const query = `
  MATCH (episode:Episode)
  WHERE episode.userId = $userId
    AND episode.contentEmbedding IS NOT NULL
  WITH episode, 
       CASE 
         WHEN size(episode.contentEmbedding) = size($embedding) 
         THEN vector.similarity.cosine($embedding, episode.contentEmbedding) 
         ELSE 0 
       END AS score
  WHERE score >= $minSimilarity
  RETURN episode, score
  ORDER BY score DESC`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    userId: params.userId,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    const episode = record.get("episode").properties;
    const score = record.get("score");

    return {
      uuid: episode.uuid,
      content: episode.content,
      contentEmbedding: episode.contentEmbedding,
      createdAt: new Date(episode.createdAt),
      validAt: new Date(episode.validAt),
      invalidAt: episode.invalidAt ? new Date(episode.invalidAt) : null,
      attributes: episode.attributesJson
        ? JSON.parse(episode.attributesJson)
        : {},
      userId: episode.userId,
    };
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
    `MATCH (e:Episode {uuid: $episodeUuid, userId: $userId}) RETURN e`,
    { episodeUuid: params.episodeUuid, userId: params.userId },
  );

  if (!episodeCheck || episodeCheck.length === 0) {
    return {
      episodeDeleted: false,
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
  const query = `
  MATCH (episode:Episode {userId: $userId})
  WHERE episode.contentEmbedding IS NOT NULL
  WITH episode, 
       CASE 
         WHEN size(episode.contentEmbedding) = size($embedding) 
         THEN vector.similarity.cosine($embedding, episode.contentEmbedding) 
         ELSE 0 
       END AS score
  WHERE score >= $minSimilarity
  OPTIONAL MATCH (episode)-[:HAS_PROVENANCE]->(stmt:Statement)-[:HAS_SUBJECT|HAS_OBJECT]->(entity:Entity)
  WHERE entity IS NOT NULL
  RETURN DISTINCT entity`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    userId: params.userId,
  });

  return result
    .map((record) => {
      const entity = record.get("entity");
      return entity ? (entity.properties as EntityNode) : null;
    })
    .filter((entity): entity is EntityNode => entity !== null);
}
