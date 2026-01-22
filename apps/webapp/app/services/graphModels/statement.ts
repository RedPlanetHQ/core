import {
  type StatementNode,
  type Triple,
} from "@core/types";
import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";

// Get the graph provider instance
const getGraphProvider = () => ProviderFactory.getGraphProvider();
// Get the vector provider instance
const getVectorProvider = () => ProviderFactory.getVectorProvider();

export async function saveTriple(triple: Triple): Promise<string> {
  // Use the provider's saveTriple method
  return getGraphProvider().saveTriple({
    statement: triple.statement,
    subject: triple.subject,
    predicate: triple.predicate,
    object: triple.object,
    episodeUuid: triple.provenance.uuid,
    userId: triple.provenance.userId,
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
}: {
  subjectId: string;
  predicateId: string;
  userId: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  // Map subject/predicate IDs to names for provider method
  const subject = await getGraphProvider().getEntity(subjectId, userId);
  const predicate = await getGraphProvider().getEntity(predicateId, userId);

  if (!subject || !predicate) {
    return [];
  }

  const results = await getGraphProvider().findContradictoryStatements({
    subjectName: subject.name,
    predicateName: predicate.name,
    userId,
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
}: {
  subjectId: string;
  objectId: string;
  excludePredicateId?: string;
  userId: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  const results = await getGraphProvider().findStatementsWithSameSubjectObject({
    subjectId,
    objectId,
    excludePredicateId,
    userId,
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
}: {
  factEmbedding: number[];
  threshold?: number;
  excludeIds?: string[];
  userId: string;
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
  );

  // Step 3: Remove factEmbedding from results
  return statements.map(s => {
    const { factEmbedding, ...rest } = s;
    return rest;
  });
}

export async function getTripleForStatement({
  statementId,
}: {
  statementId: string;
}): Promise<Triple | null> {
  // Get the statement first to get userId
  const graphProvider = getGraphProvider();

  // Use getTriplesForStatementsBatch with single statement
  const triplesMap = await graphProvider.getTriplesForStatementsBatch([statementId], "");

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
}: {
  statementId: string;
  invalidAt: string;
  invalidatedBy?: string;
  userId: string;
}) {
  await getGraphProvider().invalidateStatement(
    statementId,
    invalidatedBy || "",
    new Date(invalidAt),
    userId
  );
}

export async function invalidateStatements({
  statementIds,
  invalidatedBy,
  userId,
}: {
  statementIds: string[];
  invalidatedBy?: string;
  userId: string;
}) {
  const invalidAt = new Date().toISOString();
  return statementIds.map(
    async (statementId) =>
      await invalidateStatement({ statementId, invalidAt, invalidatedBy, userId }),
  );
}

export async function searchStatementsByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
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
  return await getGraphProvider().getStatements(statementUuids, params.userId);
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
}: {
  statementIds: string[];
  userId: string;
}): Promise<Map<string, Triple>> {
  return getGraphProvider().getTriplesForStatementsBatch(statementIds, userId);
}

export async function getStatements({
  statementUuids,
  userId,
}: {
  statementUuids: string[];
  userId: string;
}) {
  return getGraphProvider().getStatements(statementUuids, userId);
}

/**
 * Batch version of findContradictoryStatements - find contradictory statements for multiple subject-predicate pairs
 */
export async function findContradictoryStatementsBatch({
  pairs,
  userId,
  excludeStatementIds = [],
}: {
  pairs: Array<{ subjectId: string; predicateId: string }>;
  userId: string;
  excludeStatementIds?: string[];
}): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
  if (pairs.length === 0) {
    return new Map();
  }

  return getGraphProvider().findContradictoryStatementsBatch({
    pairs,
    userId,
    excludeStatementIds,
  });
}

/**
 * Batch version of findStatementsWithSameSubjectObject
 */
export async function findStatementsWithSameSubjectObjectBatch({
  pairs,
  userId,
  excludeStatementIds = [],
}: {
  pairs: Array<{
    subjectId: string;
    objectId: string;
    excludePredicateId?: string;
  }>;
  userId: string;
  excludeStatementIds?: string[];
}): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
  if (pairs.length === 0) {
    return new Map();
  }

  return getGraphProvider().findStatementsWithSameSubjectObjectBatch({
    pairs,
    userId,
    excludeStatementIds,
  });
}

/**
 * Delete statements by their UUIDs
 */
export async function deleteStatements(
  statementUuids: string[],
  userId: string,
): Promise<void> {
  await getGraphProvider().deleteStatements(statementUuids, userId);
}


export async function getEpisodeIdsForStatements(statementUuids: string[]): Promise<Map<string, string>> {
  return getGraphProvider().getEpisodeIdsForStatements(statementUuids);
}