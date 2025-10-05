import type {
  EntityNode,
  EpisodicNode,
  StatementNode,
  Triple,
} from "@core/types";
import { runQuery } from "~/lib/neo4j.server";
import { saveEntity } from "./entity";
import { saveEpisode } from "./episode";
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
    ON CREATE SET prov.uuid = $provenanceEdgeUuid, prov.createdAt = $createdAt
  MERGE (statement)-[subj:HAS_SUBJECT]->(subject)
    ON CREATE SET subj.uuid = $subjectEdgeUuid, subj.createdAt = $createdAt
  MERGE (statement)-[pred:HAS_PREDICATE]->(predicate)
    ON CREATE SET pred.uuid = $predicateEdgeUuid, pred.createdAt = $createdAt
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
      MATCH (statement:Statement)-[:HAS_SUBJECT]->(subject)
      MATCH (statement)-[:HAS_PREDICATE]->(predicate)
      WHERE statement.userId = $userId
        AND statement.invalidAt IS NULL
      RETURN statement
    `;

  const result = await runQuery(query, { subjectId, predicateId, userId });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    const statement = record.get("statement").properties;
    return {
      uuid: statement.uuid,
      fact: statement.fact,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      invalidatedBy: statement.invalidatedBy || undefined,
      attributes: statement.attributes
        ? JSON.parse(statement.attributes)
        : {},
      userId: statement.userId,
    };
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
      MATCH (statement:Statement)-[:HAS_SUBJECT]->(subject)
      MATCH (statement)-[:HAS_OBJECT]->(object)
      MATCH (statement)-[:HAS_PREDICATE]->(predicate:Entity)
      WHERE statement.userId = $userId
        AND statement.invalidAt IS NULL
        ${excludePredicateId ? "AND predicate.uuid <> $excludePredicateId" : ""}
      RETURN statement
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
    const statement = record.get("statement").properties;
    return {
      uuid: statement.uuid,
      fact: statement.fact,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      invalidatedBy: statement.invalidatedBy || undefined,
      attributes: statement.attributes
        ? JSON.parse(statement.attributes)
        : {},
      userId: statement.userId,
    };
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
  const query = `
      CALL db.index.vector.queryNodes('statement_embedding', $topK, $factEmbedding)
      YIELD node AS statement, score
      WHERE statement.userId = $userId
        AND statement.invalidAt IS NULL
        AND score >= $threshold
        ${excludeIds.length > 0 ? "AND NOT statement.uuid IN $excludeIds" : ""}
      RETURN statement, score
      ORDER BY score DESC
    `;

  const result = await runQuery(query, {
    factEmbedding,
    threshold,
    excludeIds,
    userId,
    topK: 100,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    const statement = record.get("statement").properties;

    return {
      uuid: statement.uuid,
      fact: statement.fact,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      invalidatedBy: statement.invalidatedBy || undefined,
      attributes: statement.attributes
        ? JSON.parse(statement.attributes)
        : {},
      userId: statement.userId,
    };
  });
}

export async function getTripleForStatement({
  statementId,
}: {
  statementId: string;
}): Promise<Triple | null> {
  const query = `
      MATCH (statement:Statement {uuid: $statementId})
      MATCH (statement)-[:HAS_SUBJECT]->(subject:Entity)
      MATCH (statement)-[:HAS_PREDICATE]->(predicate:Entity)
      MATCH (statement)-[:HAS_OBJECT]->(object:Entity)
      OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(statement)
      RETURN statement, subject, predicate, object, episode
    `;

  const result = await runQuery(query, { statementId });

  if (!result || result.length === 0) {
    return null;
  }

  const record = result[0];

  const statementProps = record.get("statement").properties;
  const subjectProps = record.get("subject").properties;
  const predicateProps = record.get("predicate").properties;
  const objectProps = record.get("object").properties;
  const episodeProps = record.get("episode")?.properties;

  const statement: StatementNode = {
    uuid: statementProps.uuid,
    fact: statementProps.fact,
    factEmbedding: statementProps.factEmbedding,
    createdAt: new Date(statementProps.createdAt),
    validAt: new Date(statementProps.validAt),
    invalidAt: statementProps.invalidAt
      ? new Date(statementProps.invalidAt)
      : null,
    invalidatedBy: statementProps.invalidatedBy || undefined,
    attributes: statementProps.attributes
      ? JSON.parse(statementProps.attributes)
      : {},
    userId: statementProps.userId,
  };

  const subject: EntityNode = {
    uuid: subjectProps.uuid,
    name: subjectProps.name,
    type: subjectProps.type,
    nameEmbedding: subjectProps.nameEmbedding,
    typeEmbedding: subjectProps.typeEmbedding,
    attributes: subjectProps.attributes
      ? JSON.parse(subjectProps.attributes)
      : {},
    createdAt: new Date(subjectProps.createdAt),
    userId: subjectProps.userId,
  };

  const predicate: EntityNode = {
    uuid: predicateProps.uuid,
    name: predicateProps.name,
    type: predicateProps.type,
    nameEmbedding: predicateProps.nameEmbedding,
    typeEmbedding: predicateProps.typeEmbedding,
    attributes: predicateProps.attributes
      ? JSON.parse(predicateProps.attributes)
      : {},
    createdAt: new Date(predicateProps.createdAt),
    userId: predicateProps.userId,
  };

  const object: EntityNode = {
    uuid: objectProps.uuid,
    name: objectProps.name,
    type: objectProps.type,
    nameEmbedding: objectProps.nameEmbedding,
    typeEmbedding: objectProps.typeEmbedding,
    attributes: objectProps.attributes
      ? JSON.parse(objectProps.attributes)
      : {},
    createdAt: new Date(objectProps.createdAt),
    userId: objectProps.userId,
  };

  // Episode might be null
  const provenance: EpisodicNode = {
    uuid: episodeProps.uuid,
    content: episodeProps.content,
    originalContent: episodeProps.originalContent,
    source: episodeProps.source,
    metadata: episodeProps.metadata,
    createdAt: new Date(episodeProps.createdAt),
    validAt: new Date(episodeProps.validAt),
    contentEmbedding: episodeProps.contentEmbedding,
    userId: episodeProps.userId,
    labels: episodeProps.labels || [],
    space: episodeProps.space,
    sessionId: episodeProps.sessionId,
  };

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
      MATCH (statement:Statement {uuid: $statementId})
      SET statement.invalidAt = $invalidAt
      ${invalidatedBy ? "SET statement.invalidatedBy = $invalidatedBy" : ""}
      RETURN statement
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

  return result[0].get("statement").properties;
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
  const query = `
  CALL db.index.vector.queryNodes('statement_embedding', $topK, $embedding)
  YIELD node AS statement, score
  WHERE statement.userId = $userId
    AND statement.invalidAt IS NULL
    AND score >= $minSimilarity
  RETURN statement, score
  ORDER BY score DESC
`;

  const result = await runQuery(query, {
    embedding: params.embedding,
    minSimilarity: params.minSimilarity,
    limit: params.limit,
    userId: params.userId,
    topK: params.limit || 100,
  });

  if (!result || result.length === 0) {
    return [];
  }

  return result.map((record) => {
    const statement = record.get("statement").properties;

    return {
      uuid: statement.uuid,
      fact: statement.fact,
      factEmbedding: statement.factEmbedding,
      createdAt: new Date(statement.createdAt),
      validAt: new Date(statement.validAt),
      invalidAt: statement.invalidAt ? new Date(statement.invalidAt) : null,
      invalidatedBy: statement.invalidatedBy || undefined,
      attributes: statement.attributes
        ? JSON.parse(statement.attributes)
        : {},
      userId: statement.userId,
    };
  });
}
