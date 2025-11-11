import {
  ENTITY_NODE_PROPERTIES,
  EPISODIC_NODE_PROPERTIES,
  STATEMENT_NODE_PROPERTIES,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type Triple,
} from "@core/types";
import { runQuery } from "~/lib/neo4j.server";
import { parseEntityNode, saveEntity } from "./entity";
import { parseEpisodicNode, saveEpisode } from "./episode";
import crypto from "crypto";

export async function saveTriple(triple: Triple): Promise<string> {
  // First, save the Episode
  await saveEpisode(triple.provenance);

  // Then, save the Statement
  const statementQuery = `
        MERGE (n:Statement {uuid: $uuid, userId: $userId})
        ON CREATE SET
          n.fact = $fact,
          n.factEmbedding = $factEmbedding,
          n.createdAt = $createdAt,
          n.validAt = $validAt,
          n.invalidAt = $invalidAt,
          n.invalidatedBy = $invalidatedBy,
          n.attributes = $attributes,
          n.userId = $userId,
          n.space = $space
        ON MATCH SET
          n.fact = $fact,
          n.factEmbedding = $factEmbedding,
          n.validAt = $validAt,
          n.invalidAt = $invalidAt,
          n.invalidatedBy = $invalidatedBy,
          n.attributes = $attributes,
          n.space = $space
        RETURN n.uuid as uuid
      `;

  const statementParams = {
    uuid: triple.statement.uuid,
    fact: triple.statement.fact,
    factEmbedding: triple.statement.factEmbedding,
    createdAt: triple.statement.createdAt.toISOString(),
    validAt: triple.statement.validAt.toISOString(),
    invalidAt: triple.statement.invalidAt
      ? triple.statement.invalidAt.toISOString()
      : null,
    invalidatedBy: triple.statement.invalidatedBy || null,
    attributes: JSON.stringify(triple.statement.attributes || {}),
    userId: triple.provenance.userId,
    space: triple.statement.space || null,
  };

  const statementResult = await runQuery(statementQuery, statementParams);
  const statementUuid = statementResult[0].get("uuid");

  // Then, save the Entities
  const subjectUuid = await saveEntity(triple.subject);
  const predicateUuid = await saveEntity(triple.predicate);
  const objectUuid = await saveEntity(triple.object);

  // Then, create relationships
  const relationshipsQuery = `
  MATCH (statement:Statement {uuid: $statementUuid, userId: $userId})
  MATCH (subject:Entity {uuid: $subjectUuid, userId: $userId})   
  MATCH (predicate:Entity {uuid: $predicateUuid, userId: $userId})
  MATCH (object:Entity {uuid: $objectUuid, userId: $userId})
  MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId})
  
  MERGE (episode)-[prov:HAS_PROVENANCE]->(statement)
    ON CREATE SET prov.uuid = $provenanceEdgeUuid, prov.createdAt = $createdAt, prov.userId = $userId
  MERGE (statement)-[subj:HAS_SUBJECT]->(subject)
    ON CREATE SET subj.uuid = $subjectEdgeUuid, subj.createdAt = $createdAt, subj.userId = $userId
  MERGE (statement)-[pred:HAS_PREDICATE]->(predicate)
    ON CREATE SET pred.uuid = $predicateEdgeUuid, pred.createdAt = $createdAt, pred.userId = $userId
  MERGE (statement)-[obj:HAS_OBJECT]->(object)
    ON CREATE SET obj.uuid = $objectEdgeUuid, obj.createdAt = $createdAt
  
  RETURN statement.uuid as uuid
  `;

  const now = new Date().toISOString();
  const relationshipsParams = {
    statementUuid,
    subjectUuid,
    predicateUuid,
    objectUuid,
    episodeUuid: triple.provenance.uuid,
    subjectEdgeUuid: crypto.randomUUID(),
    predicateEdgeUuid: crypto.randomUUID(),
    objectEdgeUuid: crypto.randomUUID(),
    provenanceEdgeUuid: crypto.randomUUID(),
    createdAt: now,
    userId: triple.provenance.userId,
  };

  await runQuery(relationshipsQuery, relationshipsParams);
  return statementUuid;
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
  const query = `
      MATCH (subject:Entity {uuid: $subjectId}), (predicate:Entity {uuid: $predicateId})
      MATCH (subject)<-[:HAS_SUBJECT]-(s:Statement)-[:HAS_PREDICATE]->(predicate)
      WHERE s.userId = $userId
        AND s.invalidAt IS NULL
      RETURN ${STATEMENT_NODE_PROPERTIES} as statement
    `;

  const result = await runQuery(query, { subjectId, predicateId, userId });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    return parseStatementNode(record.get("statement"));
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
  const query = `
      MATCH (subject:Entity {uuid: $subjectId}), (object:Entity {uuid: $objectId})
      MATCH (subject)<-[:HAS_SUBJECT]-(s:Statement)-[:HAS_OBJECT]->(object)
      MATCH (s)-[:HAS_PREDICATE]->(predicate:Entity)
      WHERE s.userId = $userId
        AND s.invalidAt IS NULL
        ${excludePredicateId ? "AND predicate.uuid <> $excludePredicateId" : ""}
      RETURN ${STATEMENT_NODE_PROPERTIES} as statement
    `;

  const params = {
    subjectId,
    objectId,
    userId,
    ...(excludePredicateId && { excludePredicateId }),
  };
  const result = await runQuery(query, params);

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    return parseStatementNode(record.get("statement"));
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
  const limit = 100;
  const query = `
      MATCH (statement:Statement{userId: $userId})
      WHERE statement.factEmbedding IS NOT NULL
      WITH statement, gds.similarity.cosine(statement.factEmbedding, $factEmbedding) AS score
      WHERE score >= $threshold
      RETURN ${STATEMENT_NODE_PROPERTIES} as statement, score
      ORDER BY score DESC
      LIMIT ${limit}
    `;

  const result = await runQuery(query, {
    factEmbedding,
    threshold,
    excludeIds,
    userId,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    return parseStatementNode(record.get("statement"));
  });
}

export async function getTripleForStatement({
  statementId,
}: {
  statementId: string;
}): Promise<Triple | null> {
  const query = `
      MATCH (statement:Statement {uuid: $statementId})
      MATCH (subject:Entity)<-[:HAS_SUBJECT]-(statement)
      MATCH (predicate:Entity)<-[:HAS_PREDICATE]-(statement)
      MATCH (object:Entity)<-[:HAS_OBJECT]-(statement)
      OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(statement)
      RETURN ${STATEMENT_NODE_PROPERTIES.replace(/s\./g, "statement.")} as statement, 
      ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "subject.")} as subject, 
      ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "predicate.")} as predicate, 
      ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "object.")} as object, 
      ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "episode.")} as episode
    `;

  const result = await runQuery(query, { statementId });

  if (!result || result.length === 0) {
    return null;
  }

  const record = result[0];

  const statementProps = record.get("statement");
  const subjectProps = record.get("subject");
  const predicateProps = record.get("predicate");
  const objectProps = record.get("object");
  const episodeProps = record.get("episode");

  const statement: StatementNode = parseStatementNode(statementProps);

  const subject: EntityNode = parseEntityNode(subjectProps);

  const predicate: EntityNode = parseEntityNode(predicateProps);

  const object: EntityNode = parseEntityNode(objectProps);

  // Episode might be null
  const provenance: EpisodicNode = parseEpisodicNode(episodeProps);

  return {
    statement,
    subject,
    predicate,
    object,
    provenance,
  };
}

export async function invalidateStatement({
  statementId,
  invalidAt,
  invalidatedBy,
}: {
  statementId: string;
  invalidAt: string;
  invalidatedBy?: string;
}) {
  const query = `
      MATCH (s:Statement {uuid: $statementId})
      SET s.invalidAt = $invalidAt
      ${invalidatedBy ? "SET s.invalidatedBy = $invalidatedBy" : ""}
      RETURN ${STATEMENT_NODE_PROPERTIES} as statement
    `;

  const params = {
    statementId,
    invalidAt,
    ...(invalidatedBy && { invalidatedBy }),
  };
  const result = await runQuery(query, params);

  if (!result || result.length === 0) {
    return null;
  }

  return result[0].get("statement");
}

export async function invalidateStatements({
  statementIds,
  invalidatedBy,
}: {
  statementIds: string[];
  invalidatedBy?: string;
}) {
  const invalidAt = new Date().toISOString();
  return statementIds.map(
    async (statementId) =>
      await invalidateStatement({ statementId, invalidAt, invalidatedBy }),
  );
}

export async function searchStatementsByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
}) {
  const limit = params.limit || 100;
  const query = `
  MATCH (statement:Statement{userId: $userId})
  WHERE statement.factEmbedding IS NOT NULL
  WITH statement, gds.similarity.cosine(statement.factEmbedding, $embedding) AS score
  WHERE score >= $minSimilarity
  RETURN ${STATEMENT_NODE_PROPERTIES} as statement, score
  ORDER BY score DESC
  LIMIT ${limit}
`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    limit: params.limit,
    userId: params.userId,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    return parseStatementNode(record.get("statement"));
  });
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
    attributes: node.attributes ? JSON.parse(node.attributes) : {},
    userId: node.userId,
  };
}
