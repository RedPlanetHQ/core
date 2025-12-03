import neo4j from "neo4j-driver";
import { type RawTriplet } from "~/components/graph/type";
import { logger } from "~/services/logger.service";
import { singleton } from "~/utils/singleton";

// Create a singleton driver instance
const driver = singleton("neo4j", getDriver);
const EMBEDDING_MODEL_SIZE = process.env.EMBEDDING_MODEL_SIZE ?? "1024";

function getDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI ?? "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME as string,
      process.env.NEO4J_PASSWORD as string,
    ),
    {
      maxConnectionPoolSize: 50,
      logging: {
        level: "info",
        logger: (level, message) => {
          logger.info(message);
        },
      },
    },
  );
}

let schemaInitialized = false;

// Test the connection
const verifyConnectivity = async () => {
  try {
    await driver.getServerInfo();
    logger.info("Connected to Neo4j database");
    return true;
  } catch (error) {
    logger.error("Failed to connect to Neo4j database");
    return false;
  }
};
// Run a Cypher query
const runQuery = async (cypher: string, params = {}) => {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } catch (error) {
    logger.error(`Error running Cypher query: ${cypher} ${error}`);
    throw error;
  } finally {
    await session.close();
  }
};

// Get all nodes and relationships for a user
export const getAllNodesForUser = async (userId: string) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n)-[r]->(m)
       WHERE n.userId = $userId OR m.userId = $userId
       RETURN n, r, m`,
      { userId },
    );
    return result.records;
  } catch (error) {
    logger.error(`Error getting nodes for user ${userId}: ${error}`);
    throw error;
  } finally {
    await session.close();
  }
};

// Get graph data with episode-episode connections based on shared statements
export const getClusteredGraphData = async (userId: string, limit?: number) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (e1:Episode {userId: $userId})-[:HAS_PROVENANCE]->(stmt:Statement)<-[:HAS_PROVENANCE]-(e2:Episode {userId: $userId})
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
         [s IN sharedStatements | s.fact] as statementFacts`,
      { userId },
    );

    logger.info(`Fetched ${result.records.length} episode pairs`);

    // Convert Cypher results to triplet format and deduplicate by edge key
    const edgeMap = new Map<string, RawTriplet>();

    result.records.forEach((record) => {
      const sourceUuid = record.get("source_uuid");
      const targetUuid = record.get("target_uuid");
      const statementFacts = record.get("statementFacts");

      // Create a consistent edge key (always use lexicographically smaller UUID first)
      const edgeKey =
        sourceUuid < targetUuid
          ? `${sourceUuid}|${targetUuid}`
          : `${targetUuid}|${sourceUuid}`;

      // Only add if this edge doesn't exist yet, or merge attributes if needed
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

    logger.info(
      `Returning ${triplets.length} final episode-episode connections (deduplicated from ${result.records.length})`,
    );

    return triplets;
  } catch (error) {
    console.log(error);
    logger.error(
      `Error getting clustered graph data for user ${userId}: ${error}`,
    );
    return [];
  } finally {
    await session.close();
  }
};

export async function initNeo4jSchemaOnce() {
  if (schemaInitialized) return;

  const session = driver.session();

  try {
    // Check if schema already exists
    const result = await session.run(`
      SHOW INDEXES YIELD name WHERE name = "entity_name" RETURN name
    `);

    if (result.records.length === 0) {
      // Run your schema creation here (indexes, constraints, etc.)
      await initializeSchema();
    }

    schemaInitialized = true;
  } catch (e: any) {
    logger.error("Error in initialising", e);
  } finally {
    await session.close();
  }
}

// Initialize the database schema
const initializeSchema = async () => {
  try {
    logger.info("Initialising neo4j schema");

    // Create constraints for unique IDs
    await runQuery(
      "CREATE CONSTRAINT episode_uuid IF NOT EXISTS FOR (n:Episode) REQUIRE n.uuid IS UNIQUE",
    );
    await runQuery(
      "CREATE CONSTRAINT entity_uuid IF NOT EXISTS FOR (n:Entity) REQUIRE n.uuid IS UNIQUE",
    );
    await runQuery(
      "CREATE CONSTRAINT statement_uuid IF NOT EXISTS FOR (n:Statement) REQUIRE n.uuid IS UNIQUE",
    );
    await runQuery(
      "CREATE CONSTRAINT cluster_uuid IF NOT EXISTS FOR (n:Cluster) REQUIRE n.uuid IS UNIQUE",
    );

    // Create indexes for better query performance
    await runQuery(
      "CREATE INDEX episode_valid_at IF NOT EXISTS FOR (n:Episode) ON (n.validAt)",
    );
    await runQuery(
      "CREATE INDEX statement_valid_at IF NOT EXISTS FOR (n:Statement) ON (n.validAt)",
    );
    await runQuery(
      "CREATE INDEX statement_invalid_at IF NOT EXISTS FOR (n:Statement) ON (n.invalidAt)",
    );
    await runQuery(
      "CREATE INDEX statement_cluster_id IF NOT EXISTS FOR (n:Statement) ON (n.clusterId)",
    );
    await runQuery(
      "CREATE INDEX entity_name IF NOT EXISTS FOR (n:Entity) ON (n.name)",
    );
    await runQuery(
      "CREATE INDEX entity_uuid IF NOT EXISTS FOR (n:Entity) ON (n.uuid)",
    );
    await runQuery(
      "CREATE INDEX entity_type IF NOT EXISTS FOR (n:Entity) ON (n.type)",
    );
    await runQuery(
      "CREATE INDEX entity_user_id IF NOT EXISTS FOR (n:Entity) ON (n.userId)",
    );
    await runQuery(
      "CREATE INDEX statement_user_id IF NOT EXISTS FOR (n:Statement) ON (n.userId)",
    );
    await runQuery(
      "CREATE INDEX cluster_user_id IF NOT EXISTS FOR (n:Cluster) ON (n.userId)",
    );
    await runQuery(
      "CREATE INDEX cluster_aspect_type IF NOT EXISTS FOR (n:Cluster) ON (n.aspectType)",
    );

    await runQuery(
      "CREATE INDEX statement_user_invalid IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.invalidAt)",
    );
    await runQuery(
      "CREATE INDEX statement_user_uuid IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.uuid)",
    );
    await runQuery(
      "CREATE INDEX entity_user_uuid IF NOT EXISTS FOR (n:Entity) ON (n.userId, n.uuid)",
    );
    await runQuery(
      "CREATE INDEX episode_user_uuid IF NOT EXISTS FOR (n:Episode) ON (n.userId, n.uuid)",
    );
    await runQuery(
      "CREATE INDEX episode_user_id IF NOT EXISTS FOR (n:Episode) ON (n.userId)",
    );

    // Composite temporal index for efficient time-range queries
    await runQuery(
      "CREATE INDEX statement_user_temporal IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.validAt, n.invalidAt)",
    );

    // Session-based episode lookups
    await runQuery(
      "CREATE INDEX episode_session_id IF NOT EXISTS FOR (n:Episode) ON (n.sessionId)",
    );

    // Composite index for entity name + userId (for exact match lookups)
    await runQuery(
      "CREATE INDEX entity_name_user IF NOT EXISTS FOR (n:Entity) ON (n.name, n.userId)",
    );

    // Composite index for session + userId (for previous episodes lookup)
    await runQuery(
      "CREATE INDEX episode_session_user IF NOT EXISTS FOR (n:Episode) ON (n.sessionId, n.userId)",
    );
    // Create vector indexes for semantic search (if using Neo4j 5.0+)
    await runQuery(`
      CREATE VECTOR INDEX entity_embedding IF NOT EXISTS FOR (n:Entity) ON n.nameEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBEDDING_MODEL_SIZE}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
    `);

    await runQuery(`
      CREATE VECTOR INDEX statement_embedding IF NOT EXISTS FOR (n:Statement) ON n.factEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBEDDING_MODEL_SIZE}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
    `);

    await runQuery(`
      CREATE VECTOR INDEX episode_embedding IF NOT EXISTS FOR (n:Episode) ON n.contentEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBEDDING_MODEL_SIZE}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
    `);

    // Create fulltext indexes for BM25 search
    await runQuery(`
      CREATE FULLTEXT INDEX statement_fact_index IF NOT EXISTS
      FOR (n:Statement) ON EACH [n.fact]
      OPTIONS {
        indexConfig: {
          \`fulltext.analyzer\`: 'english'
        }
      }
    `);

    await runQuery(`
      CREATE FULLTEXT INDEX entity_name_index IF NOT EXISTS
      FOR (n:Entity) ON EACH [n.name]
      OPTIONS {
        indexConfig: {
          \`fulltext.analyzer\`: 'english'
        }
      }
    `);

    // Create relationship indexes for faster traversal
    await runQuery(`
      CREATE INDEX rel_has_provenance IF NOT EXISTS
      FOR ()-[r:HAS_PROVENANCE]-()
      ON (r.userId)
    `);

    await runQuery(`
      CREATE INDEX rel_has_subject IF NOT EXISTS
      FOR ()-[r:HAS_SUBJECT]-()
      ON (r.userId)
    `);

    await runQuery(`
      CREATE INDEX rel_has_object IF NOT EXISTS
      FOR ()-[r:HAS_OBJECT]-()
      ON (r.userId)
    `);

    logger.info("Neo4j schema initialized successfully");
    return true;
  } catch (error) {
    logger.error("Failed to initialize Neo4j schema", { error });
    return false;
  }
};

// Close the driver when the application shuts down
const closeDriver = async () => {
  await driver.close();
  logger.info("Neo4j driver closed");
};

export { driver, verifyConnectivity, runQuery, initializeSchema, closeDriver };
