import neo4j from "neo4j-driver";
import { type RawTriplet } from "~/components/graph/type";
import { logger } from "~/services/logger.service";

// Create a driver instance
const driver = neo4j.driver(
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

let schemaInitialized = false;

// Test the connection
const verifyConnectivity = async () => {
  try {
    await driver.verifyConnectivity();
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
      "CREATE INDEX cluster_user_id IF NOT EXISTS FOR (n:Cluster) ON (n.userId)",
    );
    await runQuery(
      "CREATE INDEX cluster_aspect_type IF NOT EXISTS FOR (n:Cluster) ON (n.aspectType)",
    );

    // Create vector indexes for semantic search (if using Neo4j 5.0+)
    await runQuery(`
      CREATE VECTOR INDEX entity_embedding IF NOT EXISTS FOR (n:Entity) ON n.nameEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: 1536, \`vector.similarity_function\`: 'cosine'}}
    `);

    await runQuery(`
      CREATE VECTOR INDEX statement_embedding IF NOT EXISTS FOR (n:Statement) ON n.factEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: 1536, \`vector.similarity_function\`: 'cosine'}}
    `);

    await runQuery(`
      CREATE VECTOR INDEX episode_embedding IF NOT EXISTS FOR (n:Episode) ON n.contentEmbedding
      OPTIONS {indexConfig: {\`vector.dimensions\`: 1536, \`vector.similarity_function\`: 'cosine'}}
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
      FOR (n:Entity) ON EACH [n.name, n.description]
      OPTIONS {
        indexConfig: {
          \`fulltext.analyzer\`: 'english'
        }
      }
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
