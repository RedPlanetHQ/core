import type { EntityNode } from "@core/types";
import { runQuery } from "~/lib/neo4j.server";

export async function saveEntity(entity: EntityNode): Promise<string> {
  // Build query conditionally based on whether typeEmbedding exists
  const hasTypeEmbedding = entity.typeEmbedding && entity.typeEmbedding.length > 0;
  
  const query = `
    MERGE (n:Entity {uuid: $uuid})
      ON CREATE SET
        n.name = $name,
        n.type = $type,
        n.attributes = $attributes,
        n.nameEmbedding = $nameEmbedding,
        ${hasTypeEmbedding ? 'n.typeEmbedding = $typeEmbedding,' : ''}
        n.createdAt = $createdAt,
        n.userId = $userId,
        n.space = $space
      ON MATCH SET
        n.name = $name,
        n.type = $type,
        n.attributes = $attributes,
        n.nameEmbedding = $nameEmbedding,
        ${hasTypeEmbedding ? 'n.typeEmbedding = $typeEmbedding,' : ''}
        n.space = $space
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
    space: entity.space || null,
  };

  // Add typeEmbedding to params only if it exists
  if (hasTypeEmbedding) {
    params.typeEmbedding = entity.typeEmbedding;
  }

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

export async function getEntity(uuid: string): Promise<EntityNode | null> {
  const query = `
    MATCH (entity:Entity {uuid: $uuid})
    RETURN entity
  `;

  const result = await runQuery(query, { uuid });
  if (result.length === 0) return null;

  const entity = result[0].get("entity").properties;
  return {
    uuid: entity.uuid,
    name: entity.name,
    type: entity.type || null,
    attributes: JSON.parse(entity.attributes || "{}"),
    nameEmbedding: entity.nameEmbedding,
    typeEmbedding: entity.typeEmbedding || null,
    createdAt: new Date(entity.createdAt),
    userId: entity.userId,
    space: entity.space,
  };
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
  WHERE entity.nameEmbedding IS NOT NULL
  WITH entity, gds.similarity.cosine(entity.nameEmbedding, $queryEmbedding) AS score
  WHERE score >= $threshold
  RETURN entity, score
  ORDER BY score DESC
  LIMIT ${limit}
  `

  const result = await runQuery(query, { ...params });
  return result.map((record) => {
    const entity = record.get("entity").properties;

    return {
      uuid: entity.uuid,
      name: entity.name,
      type: entity.type,
      attributes: JSON.parse(entity.attributes || "{}"),
      nameEmbedding: entity.nameEmbedding,
      typeEmbedding: entity.typeEmbedding,
      createdAt: new Date(entity.createdAt),
      userId: entity.userId,
      space: entity.space,
    };
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
    const entity = record.get("entity").properties;

    return {
      uuid: entity.uuid,
      name: entity.name,
      type: entity.type,
      attributes: JSON.parse(entity.attributes || "{}"),
      nameEmbedding: entity.nameEmbedding,
      typeEmbedding: entity.typeEmbedding,
      createdAt: new Date(entity.createdAt),
      userId: entity.userId,
      space: entity.space,
    };
  });
}

// Find exact predicate matches by name
export async function findExactPredicateMatches(params: {
  predicateName: string;
  userId: string;
}): Promise<EntityNode[]> {
  const query = `
    MATCH (entity:Entity)
    WHERE entity.type = 'Predicate' 
      AND toLower(entity.name) = toLower($predicateName)
      AND entity.userId = $userId
    RETURN entity
  `;

  const result = await runQuery(query, params);
  return result.map((record) => {
    const entity = record.get("entity").properties;

    return {
      uuid: entity.uuid,
      name: entity.name,
      type: entity.type,
      attributes: JSON.parse(entity.attributes || "{}"),
      nameEmbedding: entity.nameEmbedding,
      typeEmbedding: entity.typeEmbedding,
      createdAt: new Date(entity.createdAt),
      userId: entity.userId,
      space: entity.space,
    };
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
