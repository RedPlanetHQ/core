/**
 * Statement domain methods for Neo4j graph operations
 *
 * Handles persistence, retrieval, deletion, and analysis of Statement nodes,
 * including similarity and contradiction detection.
 */

import type { StatementNode } from "@core/types";
import { parseStatementNode } from "../parsers";
import type { Neo4jCore } from "../core";
import { STATEMENT_NODE_PROPERTIES } from "../types";

/**
 * Create statement domain methods
 *
 * @param core - Neo4j core instance with query execution capability
 * @returns Object containing all statement-related database operations
 */
export function createStatementMethods(core: Neo4jCore) {
  return {
    /**
     * Save a statement node (create or update)
     *
     * @param statement - The statement to save
     * @returns The UUID of the saved statement
     */
    async saveStatement(statement: StatementNode): Promise<string> {
      const query = `
        MERGE (n:Statement {uuid: $uuid, userId: $userId})
        ON CREATE SET
          n.fact = $fact,
          n.factEmbedding = $factEmbedding,
          n.createdAt = $createdAt,
          n.validAt = $validAt,
          n.invalidAt = $invalidAt,
          n.invalidatedBy = $invalidatedBy,
          n.attributes = $attributes,
          n.aspect = $aspect,
          n.userId = $userId,
          n.workspaceId = $workspaceId
        ON MATCH SET
          n.fact = $fact,
          n.factEmbedding = $factEmbedding,
          n.validAt = $validAt,
          n.invalidAt = $invalidAt,
          n.invalidatedBy = $invalidatedBy,
          n.attributes = $attributes,
          n.aspect = $aspect
        RETURN n.uuid as uuid
      `;

      const params = {
        uuid: statement.uuid,
        fact: statement.fact,
        factEmbedding: statement.factEmbedding || [],
        createdAt: statement.createdAt.toISOString(),
        validAt: statement.validAt.toISOString(),
        invalidAt: statement.invalidAt ? statement.invalidAt.toISOString() : null,
        invalidatedBy: statement.invalidatedBy || null,
        attributes: JSON.stringify(statement.attributes || {}),
        aspect: statement.aspect || null,
        userId: statement.userId,
        workspaceId: statement.workspaceId || null,
      };

      const result = await core.runQuery(query, params);
      return result[0].get("uuid");
    },

    /**
     * Get a statement by UUID
     *
     * @param uuid - The statement UUID
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID
     * @returns The statement node or null if not found
     */
    async getStatement(uuid: string, userId: string, workspaceId?: string): Promise<StatementNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (s:Statement {uuid: $uuid, userId: $userId${wsFilter}})
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement
      `;

      const result = await core.runQuery(query, { uuid, userId, ...(workspaceId && { workspaceId }) });
      if (result.length === 0) return null;

      return parseStatementNode(result[0].get("statement"));
    },

    /**
     * Delete multiple statements by UUID
     *
     * @param uuids - Array of statement UUIDs to delete
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID
     */
    async deleteStatements(uuids: string[], userId: string, workspaceId?: string): Promise<void> {
      if (uuids.length === 0) return;

      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (s:Statement {userId: $userId${wsFilter}})
        WHERE s.uuid IN $uuids
        DETACH DELETE s
      `;

      await core.runQuery(query, { uuids, userId, ...(workspaceId && { workspaceId }) });
    },

    /**
     * Find statements similar to a given embedding
     *
     * Uses cosine similarity to find statements with similar fact embeddings.
     *
     * @param params - Query parameters
     * @param params.queryEmbedding - The embedding vector to search against
     * @param params.threshold - Minimum similarity score (0-1)
     * @param params.limit - Maximum number of results to return
     * @param params.userId - The user ID
     * @param params.workspaceId - Optional workspace ID
     * @param params.spaceIds - Optional array of space IDs to filter by
     * @returns Array of statements with their similarity scores
     */
    async findSimilarStatements(params: {
      queryEmbedding: number[];
      threshold: number;
      limit: number;
      userId: string;
      workspaceId?: string;
      spaceIds?: string[];
    }): Promise<Array<{ statement: StatementNode; score: number }>> {
      let spaceFilter = "";
      if (params.spaceIds && params.spaceIds.length > 0) {
        spaceFilter = "AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)";
      }

      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (s:Statement{userId: $userId${wsFilter}})
        WHERE s.factEmbedding IS NOT NULL AND size(s.factEmbedding) > 0 ${spaceFilter}
        WITH s, gds.similarity.cosine(s.factEmbedding, $queryEmbedding) AS score
        WHERE score >= $threshold
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement, score
        ORDER BY score DESC
        LIMIT ${params.limit}
      `;

      const result = await core.runQuery(query, {
        queryEmbedding: params.queryEmbedding,
        threshold: params.threshold,
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        spaceIds: params.spaceIds || [],
      });

      if (!result || result.length === 0) {
        return [];
      }

      return result.map((record) => ({
        statement: parseStatementNode(record.get("statement")),
        score: record.get("score"),
      }));
    },

    /**
     * Find statements that contradict a given subject-predicate pair
     *
     * Finds all statements with the same subject and predicate that are currently valid.
     *
     * @param params - Query parameters
     * @param params.subjectName - The subject entity name
     * @param params.predicateName - The predicate entity name
     * @param params.userId - The user ID
     * @param params.workspaceId - Optional workspace ID
     * @returns Array of contradictory statements
     */
    async findContradictoryStatements(params: {
      subjectName: string;
      predicateName: string;
      userId: string;
      workspaceId?: string;
    }): Promise<StatementNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (subject:Entity {userId: $userId${wsFilter}})<-[:HAS_SUBJECT]-(s:Statement {userId: $userId${wsFilter}})
        MATCH (predicate:Entity {userId: $userId${wsFilter}})<-[:HAS_PREDICATE]-(s)
        WHERE toLower(subject.name) = toLower($subjectName)
          AND toLower(predicate.name) = toLower($predicateName)
          AND (s.invalidAt IS NULL OR s.invalidAt > datetime())
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement
      `;

      const result = await core.runQuery(query, {
        ...params,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });
      return result.map((record) => parseStatementNode(record.get("statement")));
    },

    /**
     * Mark a statement as invalidated
     *
     * Sets the invalidation timestamp and invalidation reason for a statement.
     *
     * @param uuid - The statement UUID to invalidate
     * @param invalidatedBy - The reason or reference for invalidation
     * @param invalidAt - The timestamp when the statement becomes invalid
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID
     */
    async invalidateStatement(
      uuid: string,
      invalidatedBy: string,
      invalidAt: Date,
      userId: string,
      workspaceId?: string
    ): Promise<void> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (s:Statement {uuid: $uuid, userId: $userId${wsFilter}})
        SET s.invalidAt = $invalidAt,
            s.invalidatedBy = $invalidatedBy
      `;

      await core.runQuery(query, {
        uuid,
        invalidAt: invalidAt.toISOString(),
        invalidatedBy,
        userId,
        ...(workspaceId && { workspaceId }),
      });
    },

    /**
     * Get multiple statements by UUIDs in a single query
     *
     * Bulk fetch optimization using UNWIND pattern.
     *
     * @param uuids - Array of statement UUIDs to fetch
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID
     * @returns Array of statement nodes
     */
    async getStatements(uuids: string[], userId: string, workspaceId?: string): Promise<StatementNode[]> {
      if (uuids.length === 0) return [];
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        UNWIND $uuids AS uuid
        MATCH (s:Statement {uuid: uuid, userId: $userId${wsFilter}})
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement
      `;

      const result = await core.runQuery(query, { uuids, userId, ...(workspaceId && { workspaceId }) });
      return result.map((record) => parseStatementNode(record.get("statement")));
    },

    /**
     * Find statements with same subject and object but different predicates
     *
     * Example: "John is_married_to Sarah" vs "John is_divorced_from Sarah"
     * Useful for detecting potential contradictions with different relationship types.
     *
     * @param params - Query parameters
     * @param params.subjectId - The subject entity UUID
     * @param params.objectId - The object entity UUID
     * @param params.excludePredicateId - Optional predicate UUID to exclude from results
     * @param params.userId - The user ID
     * @param params.workspaceId - Optional workspace ID
     * @returns Array of statements connecting the subject and object
     */
    async findStatementsWithSameSubjectObject(params: {
      subjectId: string;
      objectId: string;
      excludePredicateId?: string;
      userId: string;
      workspaceId?: string;
    }): Promise<StatementNode[]> {
      const wsFilter = params.workspaceId ? " AND s.workspaceId = $workspaceId" : "";
      const query = `
        MATCH (subject:Entity {uuid: $subjectId}), (object:Entity {uuid: $objectId})
        MATCH (subject)<-[:HAS_SUBJECT]-(s:Statement)-[:HAS_OBJECT]->(object)
        MATCH (s)-[:HAS_PREDICATE]->(predicate:Entity)
        WHERE s.userId = $userId
          AND s.invalidAt IS NULL
          ${params.excludePredicateId ? "AND predicate.uuid <> $excludePredicateId" : ""}
          ${wsFilter}
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement
      `;

      const result = await core.runQuery(query, {
        subjectId: params.subjectId,
        objectId: params.objectId,
        userId: params.userId,
        ...(params.excludePredicateId && { excludePredicateId: params.excludePredicateId }),
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      if (!result || result.length === 0) {
        return [];
      }

      return result.map((record) => parseStatementNode(record.get("statement")));
    },

    async findContradictoryStatementsBatch(params: {
      pairs: Array<{ subjectId: string; predicateId: string }>;
      userId: string;
      workspaceId?: string;
      excludeStatementIds?: string[];
    }): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
      const wsFilter = params.workspaceId ? " AND s.workspaceId = $workspaceId" : "";
      const query = `
        UNWIND $pairs AS pair
        MATCH (subject:Entity {uuid: pair.subjectId}), (predicate:Entity {uuid: pair.predicateId})
        MATCH (subject)<-[:HAS_SUBJECT]-(s:Statement)-[:HAS_PREDICATE]->(predicate)
        WHERE s.userId = $userId
          AND s.invalidAt IS NULL
          AND NOT s.uuid IN $excludeStatementIds
          ${wsFilter}
        RETURN pair.subjectId + '_' + pair.predicateId AS pairKey,
               collect(s {.uuid, .fact, .createdAt, .validAt, .invalidAt, .invalidatedBy, .attributes, .userId}) as statements
      `;

      const result = await core.runQuery(query, {
        pairs: params.pairs,
        userId: params.userId,
        excludeStatementIds: params.excludeStatementIds || [],
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      if (!result || result.length === 0) {
        return new Map();
      }

      const statementsMap = new Map<string, Omit<StatementNode, "factEmbedding">[]>();
      result.forEach((record) => {
        const pairKey = record.get("pairKey");
        const statements = record.get("statements");
        statementsMap.set(pairKey, statements.map((s: StatementNode) => parseStatementNode(s)));
      });

      return statementsMap;
    },

    async findStatementsWithSameSubjectObjectBatch(params: {
      pairs: Array<{ subjectId: string; objectId: string; excludePredicateId?: string }>;
      userId: string;
      workspaceId?: string;
      excludeStatementIds?: string[];
    }): Promise<Map<string, Omit<StatementNode, "factEmbedding">[]>> {
      const wsFilter = params.workspaceId ? " AND s.workspaceId = $workspaceId" : "";
      const query = `
        UNWIND $pairs AS pair
        MATCH (subject:Entity {uuid: pair.subjectId}), (object:Entity {uuid: pair.objectId})
        MATCH (subject)<-[:HAS_SUBJECT]-(s:Statement)-[:HAS_OBJECT]->(object)
        MATCH (s)-[:HAS_PREDICATE]->(predicate:Entity)
        WHERE s.userId = $userId
          AND s.invalidAt IS NULL
          AND NOT s.uuid IN $excludeStatementIds
          AND (pair.excludePredicateId IS NULL OR predicate.uuid <> pair.excludePredicateId)
          ${wsFilter}
        RETURN pair.subjectId + '_' + pair.objectId AS pairKey,
               collect(s {.uuid, .fact, .createdAt, .validAt, .invalidAt, .invalidatedBy, .attributes, .userId}) as statements
      `;

      const result = await core.runQuery(query, {
        pairs: params.pairs,
        userId: params.userId,
        excludeStatementIds: params.excludeStatementIds || [],
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      if (!result || result.length === 0) {
        return new Map();
      }

      const statementsMap = new Map<string, Omit<StatementNode, "factEmbedding">[]>();
      result.forEach((record) => {
        const pairKey = record.get("pairKey");
        const statements = record.get("statements");
        statementsMap.set(pairKey, statements.map((s: StatementNode) => parseStatementNode(s)));
      });

      return statementsMap;
    },

    async updateStatementRecallCount(userId: string, statementsUuids: string[], workspaceId?: string): Promise<void> {
      const wsFilter = workspaceId ? " AND s.workspaceId = $workspaceId" : "";
      const query = `
        MATCH (s:Statement)
        WHERE s.uuid IN $statementUuids AND s.userId = $userId${wsFilter}
        SET s.recallCount = coalesce(s.recallCount, 0) + 1
      `;

      await core.runQuery(query, { statementUuids: statementsUuids, userId, ...(workspaceId && { workspaceId }) });
    },

    async getEpisodeIdsForStatements(statementUuids: string[], userId?: string, workspaceId?: string) {
      if (statementUuids.length === 0) {
        return new Map();
      }

        const userFilter = userId ? " AND s.userId = $userId" : "";
        const wsFilter = workspaceId ? " AND s.workspaceId = $workspaceId" : "";

        // Optimized: Named rel for HAS_PROVENANCE relationship index
        const cypher = `
          MATCH (s:Statement)<-[provRel:HAS_PROVENANCE]-(e:Episode)
          WHERE s.uuid IN $statementUuids${userFilter}${wsFilter}
          RETURN s.uuid as statementUuid, e.uuid as episodeUuid
        `;

        const records = await core.runQuery(cypher, {
          statementUuids,
          ...(userId && { userId }),
          ...(workspaceId && { workspaceId }),
        });

        const map = new Map<string, string>();
        records.forEach((record) => {
          map.set(record.get("statementUuid"), record.get("episodeUuid"));
        });

        return map;
      }
  };
}
