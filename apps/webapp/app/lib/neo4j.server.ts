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

export const getNodeLinks = async (userId: string) => {
  const result = await getAllNodesForUser(userId);
  const triplets: RawTriplet[] = [];

  result.forEach((record) => {
    const sourceNode = record.get("n");
    const targetNode = record.get("m");
    const edge = record.get("r");
    triplets.push({
      sourceNode: {
        uuid: sourceNode.identity.toString(),
        labels: sourceNode.labels,
        attributes: sourceNode.properties,
        name: sourceNode.properties.name || "",
        createdAt: sourceNode.properties.createdAt || "",
      },
      edge: {
        uuid: edge.identity.toString(),
        type: edge.type,
        source_node_uuid: sourceNode.identity.toString(),
        target_node_uuid: targetNode.identity.toString(),
        createdAt: edge.properties.createdAt || "",
      },
      targetNode: {
        uuid: targetNode.identity.toString(),
        labels: targetNode.labels,
        attributes: targetNode.properties,
        name: targetNode.properties.name || "",
        createdAt: edge.properties.createdAt || "",
      },
    });
  });

  return triplets;
};

// Get graph data with cluster information for reified graph
export const getClusteredGraphData = async (userId: string) => {
  const session = driver.session();
  try {
    // Get Episode -> Entity graph, only showing entities connected to more than 1 episode
    const result = await session.run(
      `// Find entities connected to more than 1 episode
       MATCH (e:Episode{userId: $userId})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId})-[r:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(entity:Entity)
       WITH entity, count(DISTINCT e) as episodeCount
       WHERE episodeCount > 1
       WITH collect(entity.uuid) as validEntityUuids

       // Get all episodes and optionally connect to valid entities
       MATCH (e:Episode {userId: $userId})
       WITH e, validEntityUuids,
            CASE WHEN size(e.labelIds) > 0 THEN e.labelIds[0] ELSE null END as clusterId

       OPTIONAL MATCH (e)-[:HAS_PROVENANCE]->(s:Statement {userId: $userId})-[r:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(entity:Entity)
       WHERE entity.uuid IN validEntityUuids

       RETURN DISTINCT
         e.uuid as sourceUuid,
         e.content as sourceContent,
         'Episode' as sourceNodeType,
         entity.uuid as targetUuid,
         entity.name as targetName,
         'Entity' as targetNodeType,
         type(r) as edgeType,
         clusterId,
         s.createdAt as createdAt`,
      { userId },
    );

    const triplets: RawTriplet[] = [];
    const processedEdges = new Set<string>();

    result.records.forEach((record) => {
      const sourceUuid = record.get("sourceUuid");
      const sourceContent = record.get("sourceContent");
      const targetUuid = record.get("targetUuid");
      const targetName = record.get("targetName");
      const edgeType = record.get("edgeType");
      const clusterId = record.get("clusterId");
      const createdAt = record.get("createdAt");

      // Create unique edge identifier to avoid duplicates
      const edgeKey = `${sourceUuid}-${targetUuid}-${edgeType}`;
      if (processedEdges.has(edgeKey)) return;
      processedEdges.add(edgeKey);

      triplets.push({
        sourceNode: {
          uuid: sourceUuid,
          labels: ["Episode"],
          attributes: {
            nodeType: "Episode",
            content: sourceContent,
            episodeUuid: sourceUuid,
            clusterId,
          },
          name: sourceContent || sourceUuid,
          clusterId,
          createdAt: createdAt || "",
        },
        edge: {
          uuid: `${sourceUuid}-${targetUuid}-${edgeType}`,
          type: edgeType,
          source_node_uuid: sourceUuid,
          target_node_uuid: targetUuid,
          createdAt: createdAt || "",
        },
        targetNode: {
          uuid: targetUuid,
          labels: ["Entity"],
          attributes: {
            nodeType: "Entity",
            name: targetName,
            clusterId,
          },
          name: targetName || targetUuid,
          clusterId,
          createdAt: createdAt || "",
        },
      });
    });

    return triplets;
  } catch (error) {
    logger.error(
      `Error getting clustered graph data for user ${userId}: ${error}`,
    );
    throw error;
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
