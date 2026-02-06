import type { EntityNode } from "@core/types";
import { parseEntityNode } from "../parsers";
import type { Neo4jCore } from "../core";
import { ENTITY_NODE_PROPERTIES } from "../types";

export function createEntityMethods(core: Neo4jCore) {
  return {
    async getCurrentTimestamp(): Promise<Date> {
      const result = await core.runQuery("RETURN datetime() as timestamp");
      return new Date(result[0].get("timestamp"));
    },

    async saveEntity(entity: EntityNode): Promise<string> {
      const query = `
        MERGE (n:Entity {uuid: $uuid})
          ON CREATE SET
            n.name = $name,
            n.type = $type,
            n.attributes = $attributes,
            n.nameEmbedding = $nameEmbedding,
            n.createdAt = $createdAt,
            n.userId = $userId,
            n.workspaceId = $workspaceId
          ON MATCH SET
            n.name = $name,
            n.type = $type,
            n.attributes = $attributes,
            n.nameEmbedding = $nameEmbedding
          RETURN n.uuid as uuid
        `;

      const params: any = {
        uuid: entity.uuid,
        name: entity.name,
        type: entity.type || "",
        attributes: JSON.stringify(entity.attributes || {}),
        nameEmbedding: entity.nameEmbedding || [],
        createdAt: entity.createdAt.toISOString(),
        userId: entity.userId,
        workspaceId: entity.workspaceId || null,
      };

      const result = await core.runQuery(query, params);
      return result[0].get("uuid");
    },

    async getEntity(uuid: string, userId: string, workspaceId?: string): Promise<EntityNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (ent:Entity {uuid: $uuid, userId: $userId${wsFilter}})
        RETURN ${ENTITY_NODE_PROPERTIES} as entity
      `;

      const result = await core.runQuery(query, { uuid, userId, ...(workspaceId && { workspaceId }) });
      if (result.length === 0) return null;

      return parseEntityNode(result[0].get("entity"));
    },

    async getEntities(uuids: string[], userId: string, workspaceId?: string): Promise<EntityNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        UNWIND $uuids as uuid
        MATCH (ent:Entity {uuid: uuid, userId: $userId${wsFilter}})
        RETURN ${ENTITY_NODE_PROPERTIES} as entity
      `;

      const result = await core.runQuery(query, { uuids, userId, ...(workspaceId && { workspaceId }) });
      return result.map((record) => parseEntityNode(record.get("entity")));
    },

    async findSimilarEntities(params: {
      queryEmbedding: number[];
      threshold: number;
      limit: number;
      userId: string;
      workspaceId?: string;
    }): Promise<Array<{ entity: EntityNode; score: number }>> {
      if (params.queryEmbedding.length === 0) {
        return [];
      }

      const limit = params.limit || 5;
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
      MATCH (ent:Entity{userId: $userId${wsFilter}})
      WHERE ent.nameEmbedding IS NOT NULL and size(ent.nameEmbedding) > 0
      WITH ent, gds.similarity.cosine(ent.nameEmbedding, $queryEmbedding) AS score
      WHERE score >= $threshold
      RETURN ${ENTITY_NODE_PROPERTIES} as entity, score
      ORDER BY score DESC
      LIMIT ${limit}
      `;

      const result = await core.runQuery(query, params);
      return result.map((record) => {
        const obj = record.get("entity");
        return {
          entity: parseEntityNode(obj),
          score: obj.score,
        };
      });
    },

    async findExactPredicateMatches(params: {
      predicateName: string;
      userId: string;
      workspaceId?: string;
    }): Promise<EntityNode[]> {
      const wsFilter = params.workspaceId ? " AND ent.workspaceId = $workspaceId" : "";
      const query = `
        MATCH (ent:Entity {userId: $userId})
        WHERE ent.type = 'Predicate'
          AND toLower(ent.name) = toLower($predicateName)
          ${wsFilter}
        RETURN ${ENTITY_NODE_PROPERTIES} as entity
      `;

      const result = await core.runQuery(query, params);
      return result.map((record) => parseEntityNode(record.get("entity")));
    },

    async findExactEntityMatch(params: {
      entityName: string;
      userId: string;
      workspaceId?: string;
    }): Promise<EntityNode | null> {
      const wsFilter = params.workspaceId ? " AND ent.workspaceId = $workspaceId" : "";
      const query = `
        MATCH (ent:Entity {userId: $userId})
        WHERE toLower(ent.name) = toLower($entityName)
          ${wsFilter}
        RETURN ${ENTITY_NODE_PROPERTIES} as entity
      `;

      const result = await core.runQuery(query, params);
      if (result.length === 0) return null;
      return parseEntityNode(result[0].get("entity"));
    },

    async mergeEntities(
      sourceUuid: string,
      targetUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<void> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      await core.runQuery(
        `
        OPTIONAL MATCH (source:Entity {uuid: $sourceUuid, userId: $userId${wsFilter}})
        MATCH (target:Entity {uuid: $targetUuid, userId: $userId${wsFilter}})

        // Only proceed if source exists (skip if already merged)
        WITH source, target
        WHERE source IS NOT NULL

        // Merge attributes: source (newer) attributes overwrite target (older) attributes
        // Newer values take precedence for conflicts
        WITH source, target,
             CASE WHEN source.attributes IS NOT NULL THEN source.attributes ELSE '{}' END AS sourceAttrs,
             CASE WHEN target.attributes IS NOT NULL THEN target.attributes ELSE '{}' END AS targetAttrs

        // Update target with merged attributes (source/newer wins for conflicts)
        // Also update type if source has one (newer type wins)
        SET target.attributes = apoc.convert.toJson(
          apoc.map.merge(
            apoc.convert.fromJsonMap(targetAttrs),
            apoc.convert.fromJsonMap(sourceAttrs)
          )
        ),
        target.type = CASE
          WHEN source.type IS NOT NULL AND source.type <> '' THEN source.type
          WHEN target.type IS NOT NULL AND target.type <> '' THEN target.type
          ELSE target.type
        END

        // Update HAS_SUBJECT relationships
        WITH source, target
        OPTIONAL MATCH (s1:Statement{userId: $userId})-[r1:HAS_SUBJECT]->(source)
        WITH source, target, collect(s1) AS subjectStatements, collect(r1) AS subjectRels
        FOREACH (r IN subjectRels | DELETE r)
        FOREACH (s IN subjectStatements | MERGE (s)-[:HAS_SUBJECT]->(target))

        // Update HAS_PREDICATE relationships
        With source, target
        OPTIONAL MATCH (s2:Statement{userId: $userId})-[r2:HAS_PREDICATE]->(source)
        WITH source, target, collect(s2) AS predicateStatements, collect(r2) AS predicateRels
        FOREACH (r IN predicateRels | DELETE r)
        FOREACH (s IN predicateStatements | MERGE (s)-[:HAS_PREDICATE]->(target))

        // Update HAS_OBJECT relationships
        WITH source, target
        OPTIONAL MATCH (s3:Statement{userId: $userId})-[r3:HAS_OBJECT]->(source)
        WITH source, target, collect(s3) AS objectStatements, collect(r3) AS objectRels
        FOREACH (r IN objectRels | DELETE r)
        FOREACH (s IN objectStatements | MERGE (s)-[:HAS_OBJECT]->(target))

        // Delete source entity
        WITH source
        DETACH DELETE source
      `,
        { sourceUuid, targetUuid, userId, ...(workspaceId && { workspaceId }) }
      );
    },

    async deduplicateEntitiesByName(userId: string, workspaceId?: string): Promise<{ count: number; deletedUuids: string[] }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Entity {userId: $userId${wsFilter}})
        WITH toLower(e.name) AS normalizedName, collect(e) AS entities, count(e) AS cnt
        WHERE cnt > 1

        // Keep the first one as target, merge others into it
        WITH normalizedName, entities[0] AS target, entities[1..] AS duplicates

        UNWIND duplicates AS source

        // Collect UUID before moving relationships
        WITH source.uuid AS sourceUuid, source, target,
             CASE WHEN source.attributes IS NOT NULL THEN source.attributes ELSE '{}' END AS sourceAttrs,
             CASE WHEN target.attributes IS NOT NULL THEN target.attributes ELSE '{}' END AS targetAttrs

        // Merge attributes: source (newer) attributes overwrite target (older) attributes
        // Newer values take precedence for conflicts
        SET target.attributes = apoc.convert.toJson(
          apoc.map.merge(
            apoc.convert.fromJsonMap(targetAttrs),
            apoc.convert.fromJsonMap(sourceAttrs)
          )
        ),
        // Source (newer) type takes precedence if set, otherwise keep target type
        target.type = CASE
          WHEN source.type IS NOT NULL AND source.type <> '' THEN source.type
          WHEN target.type IS NOT NULL AND target.type <> '' THEN target.type
          ELSE target.type
        END

        WITH sourceUuid, source, target

        // Move HAS_SUBJECT relationships
        OPTIONAL MATCH (s1:Statement {userId: $userId})-[r1:HAS_SUBJECT]->(source)
        FOREACH (_ IN CASE WHEN s1 IS NOT NULL THEN [1] ELSE [] END |
          MERGE (s1)-[:HAS_SUBJECT]->(target)
        )
        DELETE r1

        With sourceUuid, target, source

        // Move HAS_PREDICATE relationships
        OPTIONAL MATCH (s2:Statement {userId: $userId})-[r2:HAS_PREDICATE]->(source)
        FOREACH (_ IN CASE WHEN s2 IS NOT NULL THEN [1] ELSE [] END |
          MERGE (s2)-[:HAS_PREDICATE]->(target)
        )
        DELETE r2

        With sourceUuid, target, source

        // Move HAS_OBJECT relationships
        OPTIONAL MATCH (s3:Statement {userId: $userId})-[r3:HAS_OBJECT]->(source)
        FOREACH (_ IN CASE WHEN s3 IS NOT NULL THEN [1] ELSE [] END |
          MERGE (s3)-[:HAS_OBJECT]->(target)
        )
        DELETE r3

        // Delete the duplicate entity
        With sourceUuid, source
        DETACH DELETE source

        RETURN collect(sourceUuid) AS deletedUuids
      `;

      const result = await core.runQuery(query, { userId, ...(workspaceId && { workspaceId }) });
      const deletedUuids = result[0]?.get("deletedUuids") || [];
      const count = deletedUuids.length;

      if (count > 0 && core.logger) {
        core.logger.info(`Deduplicated ${count} entities for user ${userId}`);
      }

      return { count, deletedUuids };
    },

    async deleteOrphanedEntities(userId: string, workspaceId?: string): Promise<{ count: number; deletedUuids: string[] }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const result = await core.runQuery(
        `
        MATCH (e:Entity {userId: $userId${wsFilter}})
        WHERE NOT (e)<-[:HAS_SUBJECT]-()
          AND NOT (e)<-[:HAS_PREDICATE]-()
          AND NOT (e)<-[:HAS_OBJECT]-()
        WITH e.uuid AS orphanUuid
        MATCH (orphan:Entity {uuid: orphanUuid, userId: $userId${wsFilter}})
        DETACH DELETE orphan
        RETURN collect(orphanUuid) AS deletedUuids
      `,
        { userId, ...(workspaceId && { workspaceId }) }
      );

      const deletedUuids = result[0]?.get("deletedUuids") || [];
      return { count: deletedUuids.length, deletedUuids };
    },

    async getOnboardingEntities(userId: string, workspaceId?: string): Promise<{ predicate: string; object: string }[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (user:Entity {userId: $userId${wsFilter}})
        MATCH (s:Statement)-[:HAS_SUBJECT]->(user)
        WHERE s.fact CONTAINS 'onboarding' OR EXISTS((s)-[:SOURCED_FROM]->(:Episode {source: 'onboarding'}))
        MATCH (s)-[:HAS_PREDICATE]->(p:Entity)
        MATCH (s)-[:HAS_OBJECT]->(o:Entity)
        RETURN p.name as predicate, o.name as object
      `;

      const result = await core.runQuery(query, { userId, ...(workspaceId && { workspaceId }) });

      return result.map((record) => ({ predicate: record.get("predicate") as string, object: record.get("object") as string }));
    },
  };
}
