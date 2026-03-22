import {
  EPISODIC_NODE_PROPERTIES,
  EpisodicNode,
  STATEMENT_NODE_PROPERTIES,
  StatementNode,
} from "@core/types";
import { Neo4jCore } from "../core";

export function createSearchV2Methods(core: Neo4jCore) {
  return {
    // ===== SEARCH V2 METHODS =====

    /**
     * Get episodes with statements filtered by labels, aspects, and temporal constraints
     * Used by handleAspectQuery in search-v2
     */
    async getEpisodesForAspect(params: {
      userId: string;
      workspaceId?: string;
      labelIds: string[];
      aspects: string[];
      temporalStart?: Date;
      temporalEnd?: Date;
      maxEpisodes: number;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      // s.validAt and s.invalidAt are stored as ISO strings — use string comparison
      const query = `
                MATCH (e:Episode{userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement)
                WHERE TRUE
                ${params.labelIds.length > 0 ? "AND ANY(lid IN e.labelIds WHERE lid IN $labelIds)" : ""}
                ${params.aspects.length > 0 ? "AND s.aspect IN $aspects" : ""}
                AND (s.invalidAt IS NULL OR s.invalidAt > $now)
                ${
                  params.temporalStart || params.temporalEnd
                    ? `AND (
                (s.validAt >= $startTime ${params.temporalEnd ? "AND s.validAt <= $endTime" : ""})
                OR
                (s.aspect = 'Event' AND s.attributes IS NOT NULL
                AND apoc.convert.fromJsonMap(s.attributes).event_date IS NOT NULL
                AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) >= datetime($startTime)
                ${params.temporalEnd ? "AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) <= datetime($endTime)" : ""})
                )`
                    : ""
                }

                WITH DISTINCT e
                ORDER BY e.validAt DESC
                LIMIT ${params.maxEpisodes * 2}

                RETURN ${EPISODIC_NODE_PROPERTIES} as episode
            `;

      const queryParams = {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        labelIds: params.labelIds,
        aspects: params.aspects,
        now: new Date().toISOString(),
        startTime: params.temporalStart?.toISOString() || null,
        endTime: params.temporalEnd?.toISOString() || null,
      };

      const results = await core.runQuery(query, queryParams);
      return results.map((r) => r.get("episode")).filter((ep: any) => ep != null);
    },

    /**
     * Get episodes connected to specific entities (for entity lookup)
     * Used by handleEntityLookup in search-v2
     */
    async getEpisodesForEntities(params: {
      entityUuids: string[];
      userId: string;
      workspaceId?: string;
      maxEpisodes: number;
      aspects?: string[];
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const aspectFilter =
        params.aspects && params.aspects.length > 0 ? "AND s1.aspect IN $aspects" : "";

      const query = `
                UNWIND $entityUuids as entityUuid
                MATCH (ent:Entity {uuid: entityUuid, userId: $userId${wsFilter}})

                // Find statements where entity is subject or object
                OPTIONAL MATCH (s1:Statement{userId: $userId${wsFilter}})-[:HAS_SUBJECT|HAS_OBJECT]->(ent)
                WHERE (s1.invalidAt IS NULL OR s1.invalidAt > $now)
                ${aspectFilter}

                WITH DISTINCT s1 as s
                WHERE s IS NOT NULL

                MATCH (e:Episode{userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s)
                MATCH (s)-[:HAS_SUBJECT]->(sub:Entity)
                MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
                MATCH (s)-[:HAS_OBJECT]->(obj:Entity)

                WITH s, sub, pred, obj, e
                ORDER BY s.validAt DESC
                LIMIT ${params.maxEpisodes}

                RETURN ${EPISODIC_NODE_PROPERTIES} as episode
            `;

      const results = await core.runQuery(query, {
        entityUuids: params.entityUuids,
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        now: new Date().toISOString(),
        ...(params.aspects && params.aspects.length > 0 && { aspects: params.aspects }),
      });

      return results.map((r) => r.get("episode")).filter((ep: any) => ep != null);
    },

    /**
     * Get episodes within a time range with statement filtering
     * Used by handleTemporal in search-v2
     */
    async getEpisodesForTemporal(params: {
      userId: string;
      workspaceId?: string;
      labelIds: string[];
      aspects: string[];
      startTime: Date;
      endTime?: Date;
      maxEpisodes: number;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      // s.validAt and s.invalidAt are stored as ISO strings — use string comparison
      const query = `
                MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement)
                WHERE (
                (s.validAt >= $startTime ${params.endTime ? "AND s.validAt <= $endTime" : ""})
                OR
                (s.aspect = 'Event'
                AND s.attributes IS NOT NULL
                AND apoc.convert.fromJsonMap(s.attributes).event_date IS NOT NULL
                AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) >= datetime($startTime)
                ${params.endTime ? "AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) <= datetime($endTime)" : ""})
                )
                ${params.labelIds.length > 0 ? "AND ANY(lid IN e.labelIds WHERE lid IN $labelIds)" : ""}
                ${params.aspects.length > 0 ? "AND s.aspect IN $aspects" : ""}
                AND (s.invalidAt IS NULL OR s.invalidAt > $now)

                WITH DISTINCT e
                ORDER BY e.validAt DESC
                LIMIT ${params.maxEpisodes}

                RETURN ${EPISODIC_NODE_PROPERTIES} as episode
            `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        labelIds: params.labelIds,
        aspects: params.aspects,
        now: new Date().toISOString(),
        startTime: params.startTime.toISOString(),
        endTime: params.endTime?.toISOString() || null,
      });

      return results.map((r) => r.get("episode")).filter((ep: any) => ep != null);
    },

    /**
     * Find relationship statements between two entities
     * Used by handleRelationship in search-v2
     */
    async getStatementsConnectingEntities(params: {
      userId: string;
      workspaceId?: string;
      entityUuids: string[];
      maxStatements: number;
    }): Promise<StatementNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
                MATCH (e1:Entity {userId: $userId${wsFilter}})
                WHERE e1.uuid IN $entityUuids

                MATCH (e2:Entity {userId: $userId${wsFilter}})
                WHERE e2.uuid IN $entityUuids AND e1.uuid <> e2.uuid

                MATCH (s:Statement {userId: $userId${wsFilter}})
                WHERE (
                  ((s)-[:HAS_SUBJECT]->(e1) AND (s)-[:HAS_OBJECT]->(e2))
                  OR
                  ((s)-[:HAS_SUBJECT]->(e2) AND (s)-[:HAS_OBJECT]->(e1))
                )
                AND (s.invalidAt IS NULL OR s.invalidAt > $now)

                MATCH (e:Episode)-[:HAS_PROVENANCE]->(s)
                MATCH (s)-[:HAS_SUBJECT]->(sub:Entity)
                MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
                MATCH (s)-[:HAS_OBJECT]->(obj:Entity)

                WITH DISTINCT s, sub, pred, obj, e
                ORDER BY s.validAt DESC
                LIMIT ${params.maxStatements}

                RETURN ${STATEMENT_NODE_PROPERTIES} as statement
            `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        now: new Date().toISOString(),
        entityUuids: params.entityUuids,
      });

      return results.map((r) => r.get("statement")).filter((r: any) => r != null);
    },

    /**
     * Get distinct topic label IDs and episode counts in a time range
     * Used by handleTemporalFacets in search-v2
     */
    async getTopicsForFacets(params: {
      userId: string;
      workspaceId?: string;
      startTime: Date;
      endTime?: Date;
      limit?: number;
    }): Promise<{ labelId: string; episodeCount: number }[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const limit = params.limit || 20;

      // e.createdAt is stored as an ISO string — use string comparison
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.createdAt >= $startTime
          ${params.endTime ? "AND e.createdAt <= $endTime" : ""}
          AND e.labelIds IS NOT NULL AND size(e.labelIds) > 0
        UNWIND e.labelIds AS labelId
        RETURN DISTINCT labelId, count(DISTINCT e) AS episodeCount
        ORDER BY episodeCount DESC
        LIMIT ${limit}
      `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        startTime: params.startTime.toISOString(),
        ...(params.endTime && { endTime: params.endTime.toISOString() }),
      });

      return results.map((r) => ({
        labelId: r.get("labelId") as string,
        episodeCount: r.get("episodeCount").toNumber() as number,
      }));
    },

    /**
     * Get distinct entities mentioned in statements in a time range
     * Used by handleTemporalFacets in search-v2
     */
    async getEntitiesForFacets(params: {
      userId: string;
      workspaceId?: string;
      startTime: Date;
      endTime?: Date;
      limit?: number;
    }): Promise<{ entityUuid: string; entityName: string; mentionCount: number }[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const limit = params.limit || 20;

      // s.validAt and s.invalidAt are stored as ISO strings — use string comparison
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
        WHERE s.validAt >= $startTime
          ${params.endTime ? "AND s.validAt <= $endTime" : ""}
          AND (s.invalidAt IS NULL OR s.invalidAt > $now)
        MATCH (s)-[:HAS_SUBJECT]->(subject:Entity {userId: $userId${wsFilter}})
        WHERE subject.name IS NOT NULL
        RETURN DISTINCT subject.uuid AS entityUuid, subject.name AS entityName, count(DISTINCT s) AS mentionCount
        ORDER BY mentionCount DESC
        LIMIT ${limit}
      `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        now: new Date().toISOString(),
        startTime: params.startTime.toISOString(),
        ...(params.endTime && { endTime: params.endTime.toISOString() }),
      });

      return results.map((r) => ({
        entityUuid: r.get("entityUuid") as string,
        entityName: r.get("entityName") as string,
        mentionCount: r.get("mentionCount").toNumber() as number,
      }));
    },

    /**
     * Get statement counts grouped by aspect in a time range, with sample facts
     * Used by handleTemporalFacets in search-v2
     */
    async getAspectsForFacets(params: {
      userId: string;
      workspaceId?: string;
      startTime: Date;
      endTime?: Date;
      aspects?: string[];
    }): Promise<
      {
        aspect: string;
        statementCount: number;
        statements: { fact: string; validAt: string; episodeUuid: string }[];
      }[]
    > {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      const queryParams = {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        now: new Date().toISOString(),
        startTime: params.startTime.toISOString(),
        ...(params.endTime && { endTime: params.endTime.toISOString() }),
      };

      // If specific aspects requested, run one query per aspect with LIMIT 20 (true per-aspect cap)
      if (params.aspects && params.aspects.length > 0) {
        const queryForAspect = (aspect: string) => `
          MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
          WHERE s.aspect = $aspect
            AND s.validAt >= $startTime
            ${params.endTime ? "AND s.validAt <= $endTime" : ""}
            AND (s.invalidAt IS NULL OR s.invalidAt > $now)
          WITH s, e
          ORDER BY s.validAt DESC
          LIMIT 20
          RETURN
            count(s) AS statementCount,
            collect({fact: s.fact, validAt: toString(s.validAt), episodeUuid: e.uuid}) AS statements
        `;

        const perAspectResults = await Promise.all(
          params.aspects.map(async (aspect) => {
            const rows = await core.runQuery(queryForAspect(aspect), { ...queryParams, aspect });
            if (!rows.length) return null;
            const r = rows[0];
            const statementCount = r.get("statementCount").toNumber() as number;
            if (statementCount === 0) return null;
            return {
              aspect,
              statementCount,
              statements: r.get("statements") as { fact: string; validAt: string; episodeUuid: string }[],
            };
          })
        );

        return perAspectResults
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => b.statementCount - a.statementCount);
      }

      // No aspect filter — single query across all aspects
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
        WHERE s.validAt >= $startTime
          ${params.endTime ? "AND s.validAt <= $endTime" : ""}
          AND (s.invalidAt IS NULL OR s.invalidAt > $now)
          AND s.aspect IS NOT NULL
        WITH s.aspect AS aspect, s, e
        ORDER BY s.validAt DESC
        WITH aspect,
             count(s) AS statementCount,
             collect({fact: s.fact, validAt: toString(s.validAt), episodeUuid: e.uuid})[0..20] AS statements
        RETURN aspect, statementCount, statements
        ORDER BY statementCount DESC
      `;

      const results = await core.runQuery(query, queryParams);

      return results.map((r) => ({
        aspect: r.get("aspect") as string,
        statementCount: r.get("statementCount").toNumber() as number,
        statements: r.get("statements") as { fact: string; validAt: string; episodeUuid: string }[],
      }));
    },
  };
}
