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

      const query = `
                MATCH (e:Episode{userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement)
                WHERE TRUE
                ${params.labelIds.length > 0 ? "AND ANY(lid IN e.labelIds WHERE lid IN $labelIds)" : ""}
                ${params.aspects.length > 0 ? "AND s.aspect IN $aspects" : ""}
                AND (s.invalidAt IS NULL OR s.invalidAt > datetime())
                ${
                  params.temporalStart || params.temporalEnd
                    ? `AND (
                (s.validAt >= datetime($startTime) ${params.temporalEnd ? "AND s.validAt <= datetime($endTime)" : ""})
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
      const aspectFilter = params.aspects && params.aspects.length > 0
        ? "AND s1.aspect IN $aspects"
        : "";

      const query = `
                UNWIND $entityUuids as entityUuid
                MATCH (ent:Entity {uuid: entityUuid, userId: $userId${wsFilter}})

                // Find statements where entity is subject or object
                OPTIONAL MATCH (s1:Statement{userId: $userId${wsFilter}})-[:HAS_SUBJECT|HAS_OBJECT]->(ent)
                WHERE (s1.invalidAt IS NULL OR s1.invalidAt > datetime())
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

      const query = `
                MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement)
                WHERE (
                (s.validAt >= datetime($startTime) ${params.endTime ? "AND s.validAt <= datetime($endTime)" : ""})
                OR
                (s.aspect = 'Event'
                AND s.attributes IS NOT NULL
                AND apoc.convert.fromJsonMap(s.attributes).event_date IS NOT NULL
                AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) >= datetime($startTime)
                ${params.endTime ? "AND datetime(apoc.convert.fromJsonMap(s.attributes).event_date) <= datetime($endTime)" : ""})
                )
                ${params.labelIds.length > 0 ? "AND ANY(lid IN e.labelIds WHERE lid IN $labelIds)" : ""}
                ${params.aspects.length > 0 ? "AND s.aspect IN $aspects" : ""}
                AND (s.invalidAt IS NULL OR s.invalidAt > datetime())

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
      entityHint1: string;
      entityHint2: string;
      maxStatements: number;
    }): Promise<StatementNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
                // Find entities matching first hint
                MATCH (ent1:Entity {userId: $userId${wsFilter}})
                WHERE toLower(ent1.name) CONTAINS toLower($hint1)

                // Find entities matching second hint
                MATCH (ent2:Entity {userId: $userId${wsFilter}})
                WHERE toLower(ent2.name) CONTAINS toLower($hint2)
                AND ent1.uuid <> ent2.uuid

                // Find statements connecting them (in either direction)
                MATCH (s:Statement {userId: $userId${wsFilter}})
                WHERE (
                ((s)-[:HAS_SUBJECT]->(ent1) AND (s)-[:HAS_OBJECT]->(ent2))
                OR
                ((s)-[:HAS_SUBJECT]->(ent2) AND (s)-[:HAS_OBJECT]->(ent1))
                )
                AND (s.invalidAt IS NULL OR s.invalidAt > datetime())

                MATCH (e:Episode)-[:HAS_PROVENANCE]->(s)
                MATCH (s)-[:HAS_SUBJECT]->(sub:Entity)
                MATCH (s)-[:HAS_PREDICATE]->(pred:Entity)
                MATCH (s)-[:HAS_OBJECT]->(obj:Entity)

                WITH s, sub, pred, obj, e
                ORDER BY s.validAt DESC
                LIMIT ${params.maxStatements}

                RETURN ${STATEMENT_NODE_PROPERTIES} as statement
            `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        hint1: params.entityHint1,
        hint2: params.entityHint2,
      });

      return results.map((r) => r.get("statement")).filter((r: any) => r != null);
    },

    /**
     * Get episodes filtered by labels (for exploratory queries)
     * Used by handleExploratory in search-v2
     */
    async getEpisodesForExploratory(params: {
      userId: string;
      workspaceId?: string;
      labelIds: string[];
      maxEpisodes: number;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
                MATCH (e:Episode {userId: $userId${wsFilter}})
                WHERE e.content IS NOT NULL
                AND e.content <> ""
                ${params.labelIds.length > 0 ? "AND ANY(lid IN e.labelIds WHERE lid IN $labelIds)" : ""}

                WITH e
                ORDER BY e.validAt DESC
                LIMIT ${params.maxEpisodes * 2}

                RETURN ${EPISODIC_NODE_PROPERTIES} as episode
            `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        labelIds: params.labelIds,
      });

      return results.map((r) => r.get("episode")).filter((ep: any) => ep != null);
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

      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.createdAt >= datetime($startTime)
          ${params.endTime ? "AND e.createdAt <= datetime($endTime)" : ""}
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

      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
        WHERE s.validAt >= datetime($startTime)
          ${params.endTime ? "AND s.validAt <= datetime($endTime)" : ""}
          AND (s.invalidAt IS NULL OR s.invalidAt > datetime())
        MATCH (s)-[:HAS_SUBJECT]->(subject:Entity {userId: $userId${wsFilter}})
        WHERE subject.name IS NOT NULL
        RETURN DISTINCT subject.uuid AS entityUuid, subject.name AS entityName, count(DISTINCT s) AS mentionCount
        ORDER BY mentionCount DESC
        LIMIT ${limit}
      `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
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
    }): Promise<{ aspect: string; statementCount: number; statements: { fact: string; validAt: string; episodeUuid: string }[] }[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const aspectFilter = params.aspects && params.aspects.length > 0
        ? "AND s.aspect IN $aspects"
        : "";

      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
        WHERE s.validAt >= datetime($startTime)
          ${params.endTime ? "AND s.validAt <= datetime($endTime)" : ""}
          AND (s.invalidAt IS NULL OR s.invalidAt > datetime())
          AND s.aspect IS NOT NULL
          ${aspectFilter}
        WITH s.aspect AS aspect, s, e
        ORDER BY s.validAt DESC
        WITH aspect,
             count(s) AS statementCount,
             collect({fact: s.fact, validAt: toString(s.validAt), episodeUuid: e.uuid}) AS allStatements
        RETURN aspect, statementCount, allStatements[0..50] AS statements
        ORDER BY statementCount DESC
      `;

      const results = await core.runQuery(query, {
        userId: params.userId,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
        startTime: params.startTime.toISOString(),
        ...(params.endTime && { endTime: params.endTime.toISOString() }),
        ...(params.aspects && params.aspects.length > 0 && { aspects: params.aspects }),
      });

      return results.map((r) => ({
        aspect: r.get("aspect") as string,
        statementCount: r.get("statementCount").toNumber() as number,
        statements: r.get("statements") as { fact: string; validAt: string; episodeUuid: string }[],
      }));
    },
  };
}
