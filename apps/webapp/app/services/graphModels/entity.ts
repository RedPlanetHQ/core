import { type EntityNode } from "@core/types";
import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import { logger } from "~/services/logger.service";

// Get the graph provider instance
const graphProvider = () => ProviderFactory.getGraphProvider();
// Get the vector provider instance
const vectorProvider = () => ProviderFactory.getVectorProvider();

/**
 * Parse raw entity node data from Neo4j
 */
export function parseEntityNode(raw: any): EntityNode {
  return {
    uuid: raw.uuid,
    name: raw.name,
    type: raw.type || undefined,
    attributes: raw.attributes
      ? typeof raw.attributes === "string"
        ? JSON.parse(raw.attributes)
        : raw.attributes
      : {},
    nameEmbedding: raw.nameEmbedding || [],
    createdAt: new Date(raw.createdAt),
    userId: raw.userId,
  };
}

export async function saveEntity(entity: EntityNode): Promise<string> {
  return graphProvider().saveEntity(entity);
}

export async function getEntity(
  uuid: string,
  userId: string,
  workspaceId?: string,
): Promise<EntityNode | null> {
  return graphProvider().getEntity(uuid, userId, workspaceId ?? "");
}

// Find semantically similar entities
export async function findSimilarEntities(params: {
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  userId: string;
  excludeUuids?: string[];
  workspaceId?: string;
}): Promise<EntityNode[]> {
  if (params.queryEmbedding.length === 0) {
    return [];
  }

  // Step 1: Search vector provider for similar entity IDs
  const vectorResults = await vectorProvider().search({
    vector: params.queryEmbedding,
    limit: params.limit,
    threshold: params.threshold,
    namespace: VECTOR_NAMESPACES.ENTITY,
    filter: { userId: params.userId, excludeIds: params.excludeUuids },
  });

  if (vectorResults.length === 0) {
    return [];
  }

  // Step 2: Fetch full entity data from Neo4j
  const entityUuids = vectorResults.map((r) => r.id);
  const entities = await graphProvider().getEntities(
    entityUuids,
    params.userId,
    params.workspaceId ?? "",
  );

  return entities;
}

// Find exact predicate matches by name
export async function findExactPredicateMatches(params: {
  predicateName: string;
  userId: string;
  workspaceId?: string;
}): Promise<EntityNode[]> {
  return graphProvider().findExactPredicateMatches({
    ...params,
    workspaceId: params.workspaceId ?? "",
  });
}

// Find exact match for any entity by name (case-insensitive)
export async function findExactEntityMatch(params: {
  entityName: string;
  userId: string;
  workspaceId?: string;
}): Promise<EntityNode | null> {
  return graphProvider().findExactEntityMatch({
    ...params,
    workspaceId: params.workspaceId ?? "",
  });
}

/**
 * Deduplicate entities with the same name (case-insensitive) for a user
 * Merges all duplicate entities into the first one found
 * @returns Object with count and array of merged (deleted) entity UUIDs
 */
export async function deduplicateEntitiesByName(
  userId: string,
  workspaceId?: string,
): Promise<{ count: number; deletedUuids: string[] }> {
  const result = await graphProvider().deduplicateEntitiesByName(userId, workspaceId ?? "");

  if (result.count > 0) {
    logger.info(`Deduplicated ${result.count} entities for user ${userId}`);
  }

  return result;
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
  workspaceId?: string,
): Promise<void> {
  await graphProvider().mergeEntities(sourceUuid, targetUuid, userId, workspaceId ?? "");
}

/**
 * Delete orphaned entities (entities with no relationships)
 * @returns Object with count and array of deleted entity UUIDs
 */
export async function deleteOrphanedEntities(
  userId: string,
  workspaceId?: string,
): Promise<{ count: number; deletedUuids: string[] }> {
  return graphProvider().deleteOrphanedEntities(userId, workspaceId ?? "");
}
