import type { Triple, StatementNode, EntityNode } from "@core/types";
import {
  parseStatementNode,
  parseEntityNode,
  parseEpisodicNode,
} from "../parsers";
import type { Neo4jCore } from "../core";
import { ENTITY_NODE_PROPERTIES, EPISODIC_NODE_PROPERTIES, STATEMENT_NODE_PROPERTIES } from "../types";

export function createTripleMethods(core: Neo4jCore & any) {
  return {
    async saveTriple(triple: {
      statement: StatementNode;
      subject: EntityNode;
      predicate: EntityNode;
      object: EntityNode;
      episodeUuid: string;
      userId: string;
      workspaceId?: string;
    }): Promise<string> {
      // First save the statement
      const statementUuid = await core.saveStatement(triple.statement);

      // Then save the entities
      const subjectUuid = await core.saveEntity(triple.subject);
      const predicateUuid = await core.saveEntity(triple.predicate);
      const objectUuid = await core.saveEntity(triple.object);

      const wsFilter = triple.workspaceId ? ", workspaceId: $workspaceId" : "";
      // Then create relationships
      const relationshipsQuery = `
        MATCH (statement:Statement {uuid: $statementUuid, userId: $userId${wsFilter}})
        MATCH (subject:Entity {uuid: $subjectUuid, userId: $userId${wsFilter}})
        MATCH (predicate:Entity {uuid: $predicateUuid, userId: $userId${wsFilter}})
        MATCH (object:Entity {uuid: $objectUuid, userId: $userId${wsFilter}})
        MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId${wsFilter}})

        MERGE (episode)-[prov:HAS_PROVENANCE]->(statement)
          ON CREATE SET prov.createdAt = $createdAt, prov.userId = $userId, prov.workspaceId = $workspaceId
        MERGE (statement)-[subj:HAS_SUBJECT]->(subject)
          ON CREATE SET subj.createdAt = $createdAt, subj.userId = $userId, subj.workspaceId = $workspaceId
        MERGE (statement)-[pred:HAS_PREDICATE]->(predicate)
          ON CREATE SET pred.createdAt = $createdAt, pred.userId = $userId, pred.workspaceId = $workspaceId
        MERGE (statement)-[obj:HAS_OBJECT]->(object)
          ON CREATE SET obj.createdAt = $createdAt, obj.userId = $userId, obj.workspaceId = $workspaceId

        RETURN statement.uuid as uuid
      `;

      const now = new Date().toISOString();
      await core.runQuery(relationshipsQuery, {
        statementUuid,
        subjectUuid,
        predicateUuid,
        objectUuid,
        episodeUuid: triple.episodeUuid,
        createdAt: now,
        userId: triple.userId,
        workspaceId: triple.workspaceId || null,
      });

      return statementUuid;
    },

    async getTriplesForEpisode(
      episodeUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<Triple[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(statement:Statement)
        MATCH (subject:Entity)<-[:HAS_SUBJECT]-(statement)
        MATCH (predicate:Entity)<-[:HAS_PREDICATE]-(statement)
        MATCH (object:Entity)<-[:HAS_OBJECT]-(statement)
        RETURN ${STATEMENT_NODE_PROPERTIES.replace(/s\./g, "statement.")} as statement,
               ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "subject.")} as subject,
               ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "predicate.")} as predicate,
               ${ENTITY_NODE_PROPERTIES.replace(/ent\./g, "object.")} as object,
               ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "episode.")} as episode
      `;

      const result = await core.runQuery(query, { episodeUuid, userId, ...(workspaceId && { workspaceId }) });

      return result.map((record: any) => ({
        statement: parseStatementNode(record.get("statement")),
        subject: parseEntityNode(record.get("subject")),
        predicate: parseEntityNode(record.get("predicate")),
        object: parseEntityNode(record.get("object")),
        provenance: parseEpisodicNode(record.get("episode")),
      }));
    },

    async getTriplesForStatementsBatch(
      statementUuids: string[],
      userId: string,
      workspaceId?: string
    ): Promise<Map<string, Triple>> {
      if (statementUuids.length === 0) {
        return new Map();
      }
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (statement:Statement {userId: $userId${wsFilter}})
        WHERE statement.uuid IN $statementUuids
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

      const result = await core.runQuery(query, { statementUuids, userId, ...(workspaceId && { workspaceId }) });

      const triplesMap = new Map<string, Triple>();
      result.forEach((record: any) => {
        const statementUuid = record.get("statement").uuid;
        triplesMap.set(statementUuid, {
          statement: parseStatementNode(record.get("statement")),
          subject: parseEntityNode(record.get("subject")),
          predicate: parseEntityNode(record.get("predicate")),
          object: parseEntityNode(record.get("object")),
          provenance: parseEpisodicNode(record.get("episode")),
        });
      });

      return triplesMap;
    },
  };
}
