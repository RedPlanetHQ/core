import { ENTITY_NODE_PROPERTIES, type EntityNode } from "@core/types";
import { runQuery } from "~/lib/neo4j.server";
import { logger } from "~/services/logger.service";

export async function saveEntity(entity: EntityNode): Promise<string> {
  const query = `
    MERGE (n:Entity {uuid: $uuid})
      ON CREATE SET
        n.name = $name,
        n.type = $type,
        n.attributes = $attributes,
        n.nameEmbedding = $nameEmbedding,
        n.createdAt = $createdAt,
        n.userId = $userId
      ON MATCH SET
        n.name = $name,
        n.type = $type,
        n.attributes = $attributes,
        n.nameEmbedding = $nameEmbedding
      RETURN n.uuid as uuid
    `;

  const params: any = {
    uuid: entity.uuid,
    name: entity.name,
    type: entity.type || "",
    attributes: JSON.stringify(entity.attributes || {}),
    nameEmbedding: entity.nameEmbedding,
    createdAt: entity.createdAt.toISOString(),
    userId: entity.userId,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

export async function getEntity(uuid: string): Promise<EntityNode | null> {
  const query = `
    MATCH (ent:Entity {uuid: $uuid})
    RETURN ${ENTITY_NODE_PROPERTIES} as entity
  `;

  const result = await runQuery(query, { uuid });
  if (result.length === 0) return null;

  return parseEntityNode(result[0].get("entity"));
}

// Find semantically similar entities
export async function findSimilarEntities(params: {
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  userId: string;
}): Promise<EntityNode[]> {
  if (params.queryEmbedding.length === 0) {
    return [];
  }

  const limit = params.limit || 5;
  const query = `
  MATCH (entity:Entity{userId: $userId})
  WHERE entity.nameEmbedding IS NOT NULL and size(entity.nameEmbedding) > 0
  WITH entity, gds.similarity.cosine(entity.nameEmbedding, $queryEmbedding) AS score
  WHERE score >= $threshold
  RETURN entity, score
  ORDER BY score DESC
  LIMIT ${limit}
  `;

  const result = await runQuery(query, { ...params });
  return result.map((record) => {
    return parseEntityNode(record.get("entity"));
  });
}

// Find exact predicate matches by name
export async function findExactPredicateMatches(params: {
  predicateName: string;
  userId: string;
}): Promise<EntityNode[]> {
  const query = `
    MATCH (ent:Entity)
    WHERE ent.type = 'Predicate'
      AND toLower(ent.name) = toLower($predicateName)
      AND ent.userId = $userId
    RETURN ${ENTITY_NODE_PROPERTIES} as entity
  `;

  const result = await runQuery(query, params);
  return result.map((record) => {
    return parseEntityNode(record.get("entity"));
  });
}

// Find exact match for any entity by name (case-insensitive)
export async function findExactEntityMatch(params: {
  entityName: string;
  userId: string;
}): Promise<EntityNode | null> {
  const query = `
    MATCH (ent:Entity)
    WHERE toLower(ent.name) = toLower($entityName)
      AND ent.userId = $userId
    RETURN ${ENTITY_NODE_PROPERTIES} as entity
  `;

  const result = await runQuery(query, params);
  if (result.length === 0) return null;
  return parseEntityNode(result[0].get("entity"));
}

/**
 * Replace entity references in all statements with a new entity
 * Updates all statements where the old entity appears as subject, predicate, or object
 */
export async function replaceEntityReferences(
  evolvedEntity: EntityNode,
  oldEntityUUIDs: string[],
): Promise<void> {
  // Save the new entity first to ensure it exists in the database
  await saveEntity(evolvedEntity);

  // Then update all references from old entity to new entity
  oldEntityUUIDs.forEach(async (oldEntityUUID) => {
    await updateStatementsWithNewEntity(oldEntityUUID, evolvedEntity.uuid);
  });
}

/**
 * Update all statements that reference an old entity to use the new entity
 * This includes updating subject, predicate, and object relationships
 */
export async function updateStatementsWithNewEntity(
  oldEntityUUID: string,
  newEntityUUID: string,
): Promise<void> {
  const queries = [
    // Update statements where old entity is the subject
    `
      MATCH (oldEntity:Entity {uuid: $oldEntityUUID})-[r:SUBJECT]->(statement:Statement)
      MATCH (newEntity:Entity {uuid: $newEntityUUID})
      DELETE r
      CREATE (newEntity)-[:SUBJECT]->(statement)
    `,
    // Update statements where old entity is the predicate
    `
      MATCH (oldEntity:Entity {uuid: $oldEntityUUID})-[r:PREDICATE]->(statement:Statement)
      MATCH (newEntity:Entity {uuid: $newEntityUUID})
      DELETE r
      CREATE (newEntity)-[:PREDICATE]->(statement)
    `,
    // Update statements where old entity is the object
    `
      MATCH (oldEntity:Entity {uuid: $oldEntityUUID})-[r:OBJECT]->(statement:Statement)
      MATCH (newEntity:Entity {uuid: $newEntityUUID})
      DELETE r
      CREATE (newEntity)-[:OBJECT]->(statement)
    `,
  ];

  const params = {
    oldEntityUUID,
    newEntityUUID,
  };

  // Execute all update queries
  for (const query of queries) {
    await runQuery(query, params);
  }

  // Optional: Delete the old entity if no longer referenced
  await deleteEntityIfUnreferenced(oldEntityUUID);
}

/**
 * Delete an entity if it's no longer referenced by any statements
 */
async function deleteEntityIfUnreferenced(entityUUID: string): Promise<void> {
  const checkQuery = `
    MATCH (entity:Entity {uuid: $entityUUID})
    OPTIONAL MATCH (entity)-[r]-()
    WITH entity, count(r) as relationshipCount
    WHERE relationshipCount = 0
    DELETE entity
    RETURN count(entity) as deletedCount
  `;

  await runQuery(checkQuery, { entityUUID });
}

/**
 * Helper to parse raw compact node from Neo4j
 */
export function parseEntityNode(raw: any): EntityNode {
  return {
    uuid: raw.uuid,
    name: raw.name,
    type: raw.type || null,
    nameEmbedding: raw.nameEmbedding || [],
    attributes: raw.attributes ? JSON.parse(raw.attributes) : {},
    createdAt: new Date(raw.createdAt),
    userId: raw.userId,
  };
}

/**
 * Deduplicate entities with the same name (case-insensitive) for a user
 * Merges all duplicate entities into the first one found
 */
export async function deduplicateEntitiesByName(
  userId: string,
): Promise<number> {
  const query = `
    MATCH (e:Entity {userId: $userId})
    WITH toLower(e.name) AS normalizedName, collect(e) AS entities, count(e) AS cnt
    WHERE cnt > 1

    // Keep the first one as target, merge others into it
    WITH normalizedName, entities[0] AS target, entities[1..] AS duplicates

    UNWIND duplicates AS source

    // Move HAS_SUBJECT relationships
    OPTIONAL MATCH (s1:Statement {userId: $userId})-[r1:HAS_SUBJECT]->(source)
    FOREACH (_ IN CASE WHEN s1 IS NOT NULL THEN [1] ELSE [] END |
      MERGE (s1)-[:HAS_SUBJECT]->(target)
    )
    DELETE r1

    WITH normalizedName, target, source

    // Move HAS_PREDICATE relationships
    OPTIONAL MATCH (s2:Statement {userId: $userId})-[r2:HAS_PREDICATE]->(source)
    FOREACH (_ IN CASE WHEN s2 IS NOT NULL THEN [1] ELSE [] END |
      MERGE (s2)-[:HAS_PREDICATE]->(target)
    )
    DELETE r2

    WITH normalizedName, target, source

    // Move HAS_OBJECT relationships
    OPTIONAL MATCH (s3:Statement {userId: $userId})-[r3:HAS_OBJECT]->(source)
    FOREACH (_ IN CASE WHEN s3 IS NOT NULL THEN [1] ELSE [] END |
      MERGE (s3)-[:HAS_OBJECT]->(target)
    )
    DELETE r3

    // Delete the duplicate entity
    WITH source
    DETACH DELETE source

    RETURN count(source) AS mergedCount
  `;

  const result = await runQuery(query, { userId });
  const mergedCount =
    result[0]?.get("mergedCount")?.toNumber?.() ||
    result[0]?.get("mergedCount") ||
    0;

  if (mergedCount > 0) {
    logger.info(`Deduplicated ${mergedCount} entities for user ${userId}`);
  }

  return mergedCount;
}

/**
 * Merge source entity into target entity
 * Updates all relationships pointing to source → point to target, then deletes source
 * This is idempotent - if source doesn't exist (already merged), it's a no-op
 */
export async function mergeEntities(
  sourceUuid: string,
  targetUuid: string,
  userId: string,
): Promise<void> {
  // Single query to update all relationships and delete source entity
  // Uses OPTIONAL MATCH for source to be idempotent on retry
  await runQuery(
    `
    OPTIONAL MATCH (source:Entity {uuid: $sourceUuid, userId: $userId})
    MATCH (target:Entity {uuid: $targetUuid, userId: $userId})

    // Only proceed if source exists (skip if already merged)
    WITH source, target
    WHERE source IS NOT NULL

    // Update HAS_SUBJECT relationships
    WITH source, target
    OPTIONAL MATCH (s1:Statement{userId: $userId})-[r1:HAS_SUBJECT]->(source)
    WITH source, target, collect(s1) AS subjectStatements, collect(r1) AS subjectRels
    FOREACH (r IN subjectRels | DELETE r)
    FOREACH (s IN subjectStatements | MERGE (s)-[:HAS_SUBJECT]->(target))

    // Update HAS_PREDICATE relationships
    WITH source, target
    OPTIONAL MATCH (s2:Statement{userId: $userId})-[r2:HAS_PREDICATE]->(source)
    WITH source, target, collect(s2) AS predicateStatements, collect(r2) AS predicateRels
    FOREACH (r IN predicateRels | DELETE r)
    FOREACH (s IN predicateStatements | MERGE (s)-[:HAS_PREDICATE]->(target))

    // Update HAS_OBJECT relationships
    WITH source, target
    OPTIONAL MATCH (s3:Statement{userId: $userId})-[r3:HAS_OBJECT]->(source)
    WITH source, target, collect(s3) AS objectStatements, collect(r3) AS objectRels
    FOREACH (r IN objectRels | DELETE r)
    FOREACH (s IN objectStatements | MERGE (s)-[:HAS_OBJECT]->(target))

    // Delete source entity
    WITH source
    DETACH DELETE source
  `,
    { sourceUuid, targetUuid, userId },
  );
}

/**
 * Delete orphaned entities (entities with no relationships)
 */
export async function deleteOrphanedEntities(userId: string): Promise<number> {
  const result = await runQuery(
    `
    MATCH (e:Entity {userId: $userId})
    WHERE NOT (e)<-[:HAS_SUBJECT]-()
      AND NOT (e)<-[:HAS_PREDICATE]-()
      AND NOT (e)<-[:HAS_OBJECT]-()
    WITH e, e.uuid AS uuid
    DETACH DELETE e
    RETURN count(uuid) AS deletedCount
  `,
    { userId },
  );

  return result[0]?.get("deletedCount") || 0;
}
