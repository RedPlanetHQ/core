import { Neo4jCore } from "../core";
import { RawTriplet } from "../types";

export function createUserMethods(core: Neo4jCore) {
  return {
    async deleteUser(userId: string, workspaceId?: string): Promise<void> {
      const wsFilter = workspaceId ? " AND n.workspaceId = $workspaceId" : "";
      const query = `
        MATCH (n {userId: $userId})
        WHERE true ${wsFilter}
        DETACH DELETE n
      `;

      await core.runQuery(query, { userId, ...(workspaceId && { workspaceId }) });
    },

    /**
     * Get graph data with episode-episode connections based on shared statements
     */
    async getClusteredGraphData(userId: string, limit?: number, workspaceId?: string): Promise<RawTriplet[]> {
      try {
        const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
        const query = `MATCH (e1:Episode {userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(stmt:Statement)<-[:HAS_PROVENANCE]-(e2:Episode {userId: $userId${wsFilter}})
         WHERE e1.uuid < e2.uuid

         WITH DISTINCT e1, e2, stmt

         WITH e1, e2,
              collect(DISTINCT {uuid: stmt.uuid, fact: stmt.fact}) as sharedStatements

         WITH e1, e2, sharedStatements,
              size(sharedStatements) as totalSharedStatements

         WHERE totalSharedStatements >= 1

         RETURN DISTINCT
           e1.uuid as source_uuid,
           e1.createdAt as source_createdAt,
           e1.queueId as source_queueId,
           CASE WHEN size(e1.labelIds) > 0 THEN e1.labelIds[0] ELSE null END as source_clusterId,
           e2.uuid as target_uuid,
           e2.createdAt as target_createdAt,
           e2.queueId as target_queueId,
           CASE WHEN size(e2.labelIds) > 0 THEN e2.labelIds[0] ELSE null END as target_clusterId,
           sharedStatements,
           totalSharedStatements,
           [s IN sharedStatements | s.fact] as statementFacts`

        const result = await core.runQuery(query, { userId, ...(workspaceId && { workspaceId }) })

        if (core.logger) {
          core.logger.info(`Fetched ${result.length} episode pairs`);
        }

        // Convert Cypher results to triplet format and deduplicate by edge key
        const edgeMap = new Map<string, RawTriplet>();

        result.forEach((record) => {
          const sourceUuid = record.get("source_uuid");
          const targetUuid = record.get("target_uuid");
          const statementFacts = record.get("statementFacts");

          // Create a consistent edge key (always use lexicographically smaller UUID first)
          const edgeKey =
            sourceUuid < targetUuid
              ? `${sourceUuid}|${targetUuid}`
              : `${targetUuid}|${sourceUuid}`;

          // Only add if this edge doesn't exist yet
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              sourceNode: {
                uuid: sourceUuid,
                labels: ["Episode"],
                attributes: {
                  nodeType: "Episode",
                  episodeUuid: sourceUuid,
                  clusterId: record.get("source_clusterId"),
                  queueId: record.get("source_queueId"),
                },
                clusterId: record.get("source_clusterId") || undefined,
                createdAt: record.get("source_createdAt") || "",
              },
              edge: {
                uuid: edgeKey,
                type: "SHARES_STATEMENTS_WITH",
                source_node_uuid: sourceUuid,
                target_node_uuid: targetUuid,
                attributes: {
                  totalSharedStatements: record.get("totalSharedStatements"),
                  statementFacts,
                },
                createdAt: record.get("source_createdAt") || "",
              },
              targetNode: {
                uuid: targetUuid,
                labels: ["Episode"],
                attributes: {
                  nodeType: "Episode",
                  episodeUuid: targetUuid,
                  clusterId: record.get("target_clusterId"),
                  queueId: record.get("target_queueId"),
                },
                clusterId: record.get("target_clusterId") || undefined,
                createdAt: record.get("target_createdAt") || "",
              },
            });
          }
        });

        const triplets = Array.from(edgeMap.values());

        if (core.logger) {
          core.logger.info(
            `Returning ${triplets.length} final episode-episode connections (deduplicated from ${result.length})`
          );
        }

        return triplets;
      } catch (error) {
        if (core.logger) {
          core.logger.error(`Error getting clustered graph data for user ${userId}`, { error });
        }
        return [];
      }
    }

  };
}
