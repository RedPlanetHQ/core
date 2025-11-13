import { ENTITY_NODE_PROPERTIES, type EntityNode } from "@core/types";
import { runQuery } from "~/lib/neo4j.server";

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

export async function findSimilarEntitiesWithSameType(params: {
  queryEmbedding: number[];
  entityType: string;
  limit: number;
  threshold: number;
  userId: string;
}): Promise<EntityNode[]> {
  const limit = params.limit || 5;
  const query = `
    MATCH (entity:Entity{userId: $userId})
    WHERE entity.nameEmbedding IS NOT NULL
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
