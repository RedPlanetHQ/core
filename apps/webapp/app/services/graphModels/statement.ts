import {
  type StatementNode,
  type StatementAspect,
  type Triple,
} from "@core/types";
import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";

// Get the graph provider instance
const getGraphProvider = () => ProviderFactory.getGraphProvider();
// Get the vector provider instance
const getVectorProvider = () => ProviderFactory.getVectorProvider();

export async function saveTriple(triple: Triple, workspaceId?: string): Promise<string> {
  // Use the provider's saveTriple method
  return getGraphProvider().saveTriple({
    statement: triple.statement,
    subject: triple.subject,
    predicate: triple.predicate,
    object: triple.object,
    episodeUuid: triple.provenance.uuid,
    userId: triple.provenance.userId,
    workspaceId: workspaceId ?? triple.provenance.workspaceId ?? "",
  });
}

/**
 * Find statements that might contradict a new statement (same subject and predicate)
 * Example: "John lives_in New York" vs "John lives_in San Francisco"
 */
export async function findContradictoryStatements({
  subjectId,
  predicateId,
  userId,
  workspaceId,
}: {
  subjectId: string;
  predicateId: string;
  userId: string;
  workspaceId?: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  // Map subject/predicate IDs to names for provider method
  const subject = await getGraphProvider().getEntity(subjectId, userId, workspaceId ?? "");
  const predicate = await getGraphProvider().getEntity(predicateId, userId, workspaceId ?? "");

  if (!subject || !predicate) {
    return [];
  }

  const results = await getGraphProvider().findContradictoryStatements({
    subjectName: subject.name,
    predicateName: predicate.name,
    userId,
    workspaceId: workspaceId ?? "",
  });

  return results.map(s => {
    const { factEmbedding, ...rest } = s;
    return rest;
  });
}

/**
 * Find statements with same subject and object but different predicates (potential contradictions)
 * Example: "John is_married_to Sarah" vs "John is_divorced_from Sarah"
 */
export async function findStatementsWithSameSubjectObject({
  subjectId,
  objectId,
  excludePredicateId,
  userId,
  workspaceId,
}: {
  subjectId: string;
  objectId: string;
  excludePredicateId?: string;
  userId: string;
  workspaceId?: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  const results = await getGraphProvider().findStatementsWithSameSubjectObject({
    subjectId,
    objectId,
    excludePredicateId,
    userId,
    workspaceId: workspaceId ?? "",
  });

  // Remove factEmbedding from results
  return results.map(s => {
    const { factEmbedding, ...rest } = s;
    return rest;
  });
}

/**
 * Find statements that are semantically similar to a given statement using embedding similarity
 */
export async function findSimilarStatements({
  factEmbedding,
  threshold = 0.85,
  excludeIds = [],
  userId,
  workspaceId,
}: {
  factEmbedding: number[];
  threshold?: number;
  excludeIds?: string[];
  userId: string;
  workspaceId?: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  // Step 1: Search vector provider for similar statement IDs
  const vectorResults = await getVectorProvider().search({
    vector: factEmbedding,
    limit: 100,
    threshold,
    namespace: VECTOR_NAMESPACES.STATEMENT,
    filter: { userId, excludeIds },
  });

  if (vectorResults.length === 0) {
    return [];
  }

  // Step 2: Fetch full statement data from Neo4j
  const statements = await getGraphProvider().getStatements(
    vectorResults.map(r => r.id),
    userId,
    workspaceId,
  );

  // Step 3: Remove factEmbedding from results
  return statements.map(s => {
    const { factEmbedding, ...rest } = s;
    return rest;
  });
}

export async function getTripleForStatement({
  statementId,
  workspaceId,
}: {
  statementId: string;
  workspaceId?: string;
}): Promise<Triple | null> {
  // Get the statement first to get userId
  const graphProvider = getGraphProvider();

  // Use getTriplesForStatementsBatch with single statement
  const triplesMap = await graphProvider.getTriplesForStatementsBatch([statementId], "", workspaceId);

  if (triplesMap.size === 0) {
    return null;
  }

  return triplesMap.get(statementId) || null;
}

export async function invalidateStatement({
  statementId,
  invalidAt,
  invalidatedBy,
  userId,
  workspaceId,
}: {
  statementId: string;
  invalidAt: string;
  invalidatedBy?: string;
  userId: string;
  workspaceId?: string;
}) {
  await getGraphProvider().invalidateStatement(
    statementId,
    invalidatedBy || "",
    new Date(invalidAt),
    userId,
    workspaceId,
  );
}

export async function invalidateStatements({
  statementIds,
  invalidatedBy,
  userId,
  workspaceId,
}: {
  statementIds: string[];
  invalidatedBy?: string;
  userId: string;
  workspaceId?: string;
}) {
  const invalidAt = new Date().toISOString();
  return statementIds.map(
    async (statementId) =>
      await invalidateStatement({ statementId, invalidAt, invalidatedBy, userId, workspaceId }),
  );
}

export async function searchStatementsByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
  workspaceId?: string;
}) {
  // Step 1: Search vector provider for similar episode IDs
  const vectorResults = await getVectorProvider().search({
    vector: params.embedding,
    limit: params.limit || 100,
    threshold: params.minSimilarity || 0.7,
    namespace: VECTOR_NAMESPACES.EPISODE,
    filter: { userId: params.userId },
  });

  if (vectorResults.length === 0) {
    return [];
  }

  const statementUuids = vectorResults.map(r => r.id);
  return await getGraphProvider().getStatements(statementUuids, params.userId, params.workspaceId);
}

export function parseStatementNode(node: Record<string, any>): StatementNode {
  return {
    uuid: node.uuid,
    fact: node.fact,
    factEmbedding: node.factEmbedding || [],
    createdAt: new Date(node.createdAt),
    validAt: new Date(node.validAt),
    invalidAt: node.invalidAt ? new Date(node.invalidAt) : null,
    invalidatedBy: node.invalidatedBy || undefined,
    attributes: node.attributes ? (typeof node.attributes === 'string' ? JSON.parse(node.attributes) : node.attributes) : {},
    userId: node.userId,
    labelIds: node.labelIds || undefined,
    aspect: node.aspect || null,
    recallCount: node.recallCount || undefined,
    provenanceCount: node.provenanceCount || undefined,
  };
}

/**
 * Batch version of getTripleForStatement - fetch multiple triples in a single query
 */
export async function getTripleForStatementsBatch({
  statementIds,
  userId,
  workspaceId,
}: {
  statementIds: string[];
  userId: string;
  workspaceId?: string;
}): Promise<Map<string, Triple>> {
  return getGraphProvider().getTriplesForStatementsBatch(statementIds, userId, workspaceId);
}

export async function getStatements({
  statementUuids,
  userId,
  workspaceId,
}: {
  statementUuids: string[];
  userId: string;
  workspaceId?: string;
}) {
  return getGraphProvider().getStatements(statementUuids, userId, workspaceId);
}

/**
 * Batch version of findContradictoryStatements - find contradictory statements for multiple subject-predicate pairs
 */
export async function findContradictoryStatementsBatch({
  pairs,
  userId,
  excludeStatementIds = [],
  workspaceId,
}: {
  pairs: Array<{ subjectId: string; predicateId: string }>;
  userId: string;
  excludeStatementIds?: string[];
  workspaceId?: string;
}): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
  if (pairs.length === 0) {
    return new Map();
  }

  return getGraphProvider().findContradictoryStatementsBatch({
    pairs,
    userId,
    excludeStatementIds,
    workspaceId: workspaceId ?? "",
  });
}

/**
 * Batch version of findStatementsWithSameSubjectObject
 */
export async function findStatementsWithSameSubjectObjectBatch({
  pairs,
  userId,
  excludeStatementIds = [],
  workspaceId,
}: {
  pairs: Array<{
    subjectId: string;
    objectId: string;
    excludePredicateId?: string;
  }>;
  userId: string;
  excludeStatementIds?: string[];
  workspaceId?: string;
}): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
  if (pairs.length === 0) {
    return new Map();
  }

  return getGraphProvider().findStatementsWithSameSubjectObjectBatch({
    pairs,
    userId,
    excludeStatementIds,
    workspaceId: workspaceId ?? "",
  });
}

/**
 * Delete statements by their UUIDs
 */
export async function deleteStatements(
  statementUuids: string[],
  userId: string,
  workspaceId?: string,
): Promise<void> {
  await getGraphProvider().deleteStatements(statementUuids, userId, workspaceId);
}


export async function getEpisodeIdsForStatements(statementUuids: string[], userId?: string, workspaceId?: string): Promise<Map<string, string>> {
  return getGraphProvider().getEpisodeIdsForStatements(statementUuids, userId, workspaceId);
}

/**
 * Get valid statements for an episode filtered by aspects.
 * Used to check if an episode produced persona-relevant statements (Identity, Preference, Directive).
 */
export async function getStatementsForEpisodeByAspects(
  episodeUuid: string,
  aspects: StatementAspect[],
): Promise<Omit<StatementNode, "factEmbedding">[]> {
  const query = `
    MATCH (e:Episode {uuid: $episodeUuid})-[:HAS_PROVENANCE]->(s:Statement)
    WHERE s.invalidAt IS NULL
      AND s.aspect IN $aspects
    RETURN s
  `;

  const results = await getGraphProvider().runQuery(query, {
    episodeUuid,
    aspects,
  });

  return results.map((record) => {
    const node = record.get("s").properties;
    const { factEmbedding, ...rest } = parseStatementNode(node);
    return rest;
  });
}