import type { EntityNode, StatementNode, EpisodicNode } from "@core/types";
import type { SearchOptions } from "../search.server";
import type { Embedding } from "ai";
import { logger } from "../logger.service";
import { runQuery } from "~/lib/neo4j.server";

/**
 * Perform BM25 keyword-based search on statements
 */
export async function performBM25Search(
  query: string,
  userId: string,
  options: Required<SearchOptions>,
): Promise<StatementNode[]> {
  try {
    // Sanitize the query for Lucene syntax
    const sanitizedQuery = sanitizeLuceneQuery(query);

    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt 
      AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt 
        AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
        AND s.validAt >= $startTime
      `;
    }

    // Add space filtering if spaceIds are provided
    let spaceCondition = "";
    if (options.spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    // Use Neo4j's built-in fulltext search capabilities with provenance count
    const cypher = `
        CALL db.index.fulltext.queryNodes("statement_fact_index", $query) 
        YIELD node AS s, score
        WHERE 
          (s.userId = $userId)
          ${timeframeCondition}
          ${spaceCondition}
        OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(s)
        WITH s, score, count(episode) as provenanceCount
        RETURN s, score, provenanceCount
        ORDER BY score DESC
      `;

    const params = {
      query: sanitizedQuery,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.spaceIds.length > 0 && { spaceIds: options.spaceIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const statement = record.get("s").properties as StatementNode;
      const provenanceCountValue = record.get("provenanceCount");
      statement.provenanceCount =
        typeof provenanceCountValue === "bigint"
          ? Number(provenanceCountValue)
          : (provenanceCountValue?.toNumber?.() ?? provenanceCountValue ?? 0);
      return statement;
    });
  } catch (error) {
    logger.error("BM25 search error:", { error });
    return [];
  }
}

/**
 * Sanitize a query string for Lucene syntax
 */
export function sanitizeLuceneQuery(query: string): string {
  // Escape special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
  let sanitized = query.replace(
    /[+\-&|!(){}[\]^"~*?:\\\/]/g,
    (match) => "\\" + match,
  );

  // If query is too long, truncate it
  const MAX_QUERY_LENGTH = 32;
  const words = sanitized.split(" ");
  if (words.length > MAX_QUERY_LENGTH) {
    sanitized = words.slice(0, MAX_QUERY_LENGTH).join(" ");
  }

  return sanitized;
}

/**
 * Perform vector similarity search on statement embeddings
 */
export async function performVectorSearch(
  query: Embedding,
  userId: string,
  options: Required<SearchOptions>,
): Promise<StatementNode[]> {
  try {
    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt 
      AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt 
        AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
        AND s.validAt >= $startTime
      `;
    }

    // Add space filtering if spaceIds are provided
    let spaceCondition = "";
    if (options.spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    // 1. Search for similar statements using Neo4j vector search with provenance count
    const cypher = `
      MATCH (s:Statement)
      WHERE 
      (s.userId = $userId)
      ${timeframeCondition}
      ${spaceCondition}
      WITH s, vector.similarity.cosine(s.factEmbedding, $embedding) AS score
      WHERE score > 0.7
      OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(s)
      WITH s, score, count(episode) as provenanceCount
      RETURN s, score, provenanceCount
      ORDER BY score DESC
    `;

    const params = {
      embedding: query,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.spaceIds.length > 0 && { spaceIds: options.spaceIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const statement = record.get("s").properties as StatementNode;
      const provenanceCountValue = record.get("provenanceCount");
      statement.provenanceCount =
        typeof provenanceCountValue === "bigint"
          ? Number(provenanceCountValue)
          : (provenanceCountValue?.toNumber?.() ?? provenanceCountValue ?? 0);
      return statement;
    });
  } catch (error) {
    logger.error("Vector search error:", { error });
    return [];
  }
}

/**
 * Perform BFS traversal starting from entities mentioned in the query
 */
export async function performBfsSearch(
  embedding: Embedding,
  userId: string,
  options: Required<SearchOptions>,
): Promise<StatementNode[]> {
  try {
    // 1. Extract potential entities from query
    const entities = await extractEntitiesFromQuery(embedding, userId);

    // 2. For each entity, perform BFS traversal
    const allStatements: StatementNode[] = [];

    for (const entity of entities) {
      const statements = await bfsTraversal(
        entity.uuid,
        options.maxBfsDepth,
        options.endTime,
        userId,
        options.includeInvalidated,
        options.startTime,
        options.spaceIds,
      );
      allStatements.push(...statements);
    }

    return allStatements;
  } catch (error) {
    logger.error("BFS search error:", { error });
    return [];
  }
}

/**
 * Perform BFS traversal starting from an entity
 */
export async function bfsTraversal(
  startEntityId: string,
  maxDepth: number,
  validAt: Date,
  userId: string,
  includeInvalidated: boolean,
  startTime: Date | null,
  spaceIds: string[] = [],
): Promise<StatementNode[]> {
  try {
    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt
      AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt
        AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)
        AND s.validAt >= $startTime
      `;
    }

    // Add space filtering if spaceIds are provided
    let spaceCondition = "";
    if (spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    // Use Neo4j's built-in path finding capabilities for efficient BFS
    // This query implements BFS up to maxDepth and collects all statements along the way
    const cypher = `
      MATCH (e:Entity {uuid: $startEntityId})<-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement)
      WHERE 
        (s.userId = $userId)
        AND ($includeInvalidated OR s.invalidAt IS NULL)
        ${timeframeCondition}
        ${spaceCondition}
      RETURN s as statement
    `;

    const params = {
      startEntityId,
      maxDepth,
      validAt: validAt.toISOString(),
      userId,
      includeInvalidated,
      ...(startTime && { startTime: startTime.toISOString() }),
      ...(spaceIds.length > 0 && { spaceIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map(
      (record) => record.get("statement").properties as StatementNode,
    );
  } catch (error) {
    logger.error("BFS traversal error:", { error });
    return [];
  }
}

/**
 * Extract potential entities from a query using embeddings or LLM
 */
export async function extractEntitiesFromQuery(
  embedding: Embedding,
  userId: string,
): Promise<EntityNode[]> {
  try {
    // Use vector similarity to find relevant entities
    const cypher = `
        // Match entities using vector similarity on name embeddings
        MATCH (e:Entity)
        WHERE e.nameEmbedding IS NOT NULL 
          AND e.userId = $userId
        WITH e, vector.similarity.cosine(e.nameEmbedding, $embedding) AS score
        WHERE score > 0.7
        RETURN e
        ORDER BY score DESC
        LIMIT 3
      `;

    const params = {
      embedding,
      userId,
    };

    const records = await runQuery(cypher, params);

    return records.map((record) => record.get("e").properties as EntityNode);
  } catch (error) {
    logger.error("Entity extraction error:", { error });
    return [];
  }
}

/**
 * Combine and deduplicate statements from different search methods
 */
export function combineAndDeduplicateStatements(
  statements: StatementNode[],
): StatementNode[] {
  return Array.from(
    new Map(
      statements.map((statement) => [statement.uuid, statement]),
    ).values(),
  );
}

export async function getEpisodesByStatements(
  statements: StatementNode[],
): Promise<EpisodicNode[]> {
  const cypher = `
    MATCH (s:Statement)<-[:HAS_PROVENANCE]-(e:Episode)
    WHERE s.uuid IN $statementUuids
    RETURN distinct e
  `;

  const params = {
    statementUuids: statements.map((s) => s.uuid),
  };

  const records = await runQuery(cypher, params);
  return records.map((record) => record.get("e").properties as EpisodicNode);
}
