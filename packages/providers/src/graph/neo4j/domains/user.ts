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
     * Get graph data with session-to-session connections based on shared statements
     * Each node represents a sessionId, using the latest episode of that session
     */
    async getClusteredGraphData(userId: string, limit?: number, workspaceId?: string): Promise<RawTriplet[]> {
      try {
        const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

        // Query to find session-to-session connections via shared statements
        // 1. Find all episodes with their sessionId
        // 2. Get the latest episode per sessionId
        // 3. Find connections between sessions that share statements
        const query = `
          // First, get the latest episode for each sessionId
          MATCH (e:Episode {userId: $userId${wsFilter}})
          WHERE e.sessionId IS NOT NULL
          WITH e.sessionId as sessionId, e
          ORDER BY e.createdAt DESC
          WITH sessionId, collect(e)[0] as latestEpisode

          // Now find sessions that share statements through any of their episodes
          MATCH (anyEpisode1:Episode {sessionId: sessionId, userId: $userId${wsFilter}})-[:HAS_PROVENANCE]->(stmt:Statement)<-[:HAS_PROVENANCE]-(anyEpisode2:Episode {userId: $userId${wsFilter}})
          WHERE anyEpisode1.sessionId <> anyEpisode2.sessionId
            AND anyEpisode2.sessionId IS NOT NULL

          // Get the latest episode for the connected session
          WITH sessionId, latestEpisode, anyEpisode2.sessionId as connectedSessionId, stmt
          MATCH (connectedLatest:Episode {sessionId: connectedSessionId, userId: $userId${wsFilter}})
          WITH sessionId, latestEpisode, connectedSessionId, connectedLatest, stmt
          ORDER BY connectedLatest.createdAt DESC
          WITH sessionId, latestEpisode, connectedSessionId, collect(connectedLatest)[0] as connectedLatestEpisode, count(DISTINCT stmt) as totalSharedStatements

          // Only keep unique session pairs (smaller sessionId first)
          WHERE sessionId < connectedSessionId AND totalSharedStatements >= 1

          RETURN DISTINCT
            sessionId as source_sessionId,
            latestEpisode.uuid as source_uuid,
            latestEpisode.createdAt as source_createdAt,
            latestEpisode.queueId as source_queueId,
            CASE WHEN size(latestEpisode.labelIds) > 0 THEN latestEpisode.labelIds[0] ELSE null END as source_clusterId,
            connectedSessionId as target_sessionId,
            connectedLatestEpisode.uuid as target_uuid,
            connectedLatestEpisode.createdAt as target_createdAt,
            connectedLatestEpisode.queueId as target_queueId,
            CASE WHEN size(connectedLatestEpisode.labelIds) > 0 THEN connectedLatestEpisode.labelIds[0] ELSE null END as target_clusterId,
            totalSharedStatements`

        const result = await core.runQuery(query, { userId, ...(workspaceId && { workspaceId }) })

        if (core.logger) {
          core.logger.info(`Fetched ${result.length} session pairs`);
        }

        // Convert Cypher results to triplet format and deduplicate by session pair
        const edgeMap = new Map<string, RawTriplet>();

        result.forEach((record) => {
          const sourceSessionId = record.get("source_sessionId");
          const targetSessionId = record.get("target_sessionId");
          const sourceUuid = record.get("source_uuid");
          const targetUuid = record.get("target_uuid");
          const totalSharedStatements = record.get("totalSharedStatements")?.toNumber?.() || Number(record.get("totalSharedStatements")) || 0;

          // Create a consistent edge key using sessionIds
          const edgeKey =
            sourceSessionId < targetSessionId
              ? `${sourceSessionId}|${targetSessionId}`
              : `${targetSessionId}|${sourceSessionId}`;

          // Only add if this session pair doesn't exist yet
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              sourceNode: {
                uuid: sourceSessionId,
                labels: ["Session"],
                attributes: {
                  nodeType: "Session",
                  sessionId: sourceSessionId,
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
                source_node_uuid: sourceSessionId,
                target_node_uuid: targetSessionId,
                attributes: {
                  totalSharedStatements,
                },
                createdAt: record.get("source_createdAt") || "",
              },
              targetNode: {
                uuid: targetSessionId,
                labels: ["Session"],
                attributes: {
                  nodeType: "Session",
                  sessionId: targetSessionId,
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
            `Returning ${triplets.length} final session-session connections (deduplicated from ${result.length})`
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
