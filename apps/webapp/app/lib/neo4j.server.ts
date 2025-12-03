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

// Get graph data with episode-episode connections based on shared entities
export const getClusteredGraphData = async (userId: string, limit?: number) => {
  const session = driver.session();
  try {
    // Step 1: Check total episode count
    const countResult = await session.run(
      `MATCH (e:Episode {userId: $userId})
       RETURN count(e) as totalCount`,
      { userId },
    );

    const totalEpisodes =
      countResult.records[0]?.get("totalCount")?.toNumber() || 0;
    const shouldLimit = totalEpisodes > 2000;

    logger.info(
      `Total episodes: ${totalEpisodes}, applying limit: ${shouldLimit}`,
    );

    // Step 2: Get episodes with their entities (much simpler and faster)
    const episodeQuery = shouldLimit
      ? `MATCH (e:Episode {userId: $userId})
         WITH e ORDER BY e.updatedAt DESC LIMIT 1000
         WITH collect(e.uuid) as episodeUuids
         MATCH (e:Episode {userId: $userId})
         WHERE e.uuid IN episodeUuids`
      : `MATCH (e:Episode {userId: $userId})`;

    const result = await session.run(
      `${episodeQuery}
       MATCH (e)-[:HAS_PROVENANCE]->(s:Statement {userId: $userId})
       -[r:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)

       RETURN
         e.uuid as episodeUuid,
         e.content as episodeContent,
         e.createdAt as episodeCreatedAt,
         CASE WHEN size(e.labelIds) > 0 THEN e.labelIds[0] ELSE null END as clusterId,
         entity.uuid as entityUuid,
         entity.name as entityName,
         type(r) as entityRole`,
      { userId },
    );

    logger.info(
      `Fetched ${result.records.length} episode-entity relationships`,
    );

    // Step 3: Build episode → entities map, then compute pairs in memory
    interface EpisodeData {
      uuid: string;
      content: string;
      createdAt: string;
      clusterId: string | null;
      subjects: Map<string, string>;
      predicates: Map<string, string>;
      objects: Map<string, string>;
    }

    interface EpisodePairData {
      source: EpisodeData;
      target: EpisodeData;
      subjects: Map<string, string>;
      predicates: Map<string, string>;
      objects: Map<string, string>;
    }

    const episodeMap = new Map<string, EpisodeData>();
    const entityToEpisodes = new Map<string, Set<string>>(); // entity uuid -> episode uuids

    // Build episode map and entity index
    result.records.forEach((record) => {
      const episodeUuid = record.get("episodeUuid");
      const episodeContent = record.get("episodeContent");
      const episodeCreatedAt = record.get("episodeCreatedAt");
      const clusterId = record.get("clusterId");
      const entityUuid = record.get("entityUuid");
      const entityName = record.get("entityName");
      const entityRole = record.get("entityRole");

      // Add episode to map if not exists
      if (!episodeMap.has(episodeUuid)) {
        episodeMap.set(episodeUuid, {
          uuid: episodeUuid,
          content: episodeContent,
          createdAt: episodeCreatedAt,
          clusterId,
          subjects: new Map(),
          predicates: new Map(),
          objects: new Map(),
        });
      }

      const episode = episodeMap.get(episodeUuid)!;

      // Add entity to episode's collections
      if (entityRole === "HAS_SUBJECT") {
        episode.subjects.set(entityUuid, entityName);
      } else if (entityRole === "HAS_PREDICATE") {
        episode.predicates.set(entityUuid, entityName);
      } else if (entityRole === "HAS_OBJECT") {
        episode.objects.set(entityUuid, entityName);
      }

      // Track which episodes share this entity
      if (!entityToEpisodes.has(entityUuid)) {
        entityToEpisodes.set(entityUuid, new Set());
      }
      entityToEpisodes.get(entityUuid)!.add(episodeUuid);
    });

    logger.info(
      `Built map of ${episodeMap.size} episodes with ${entityToEpisodes.size} unique entities`,
    );

    // Find episode pairs that share entities
    const episodePairMap = new Map<string, EpisodePairData>();

    for (const [entityUuid, episodeUuids] of entityToEpisodes) {
      if (episodeUuids.size < 2) continue; // Skip entities not shared

      const episodeArray = Array.from(episodeUuids);

      // Create pairs from episodes sharing this entity
      for (let i = 0; i < episodeArray.length; i++) {
        for (let j = i + 1; j < episodeArray.length; j++) {
          const ep1Uuid = episodeArray[i];
          const ep2Uuid = episodeArray[j];

          // Create canonical pair key (alphabetically sorted)
          const pairKey =
            ep1Uuid < ep2Uuid
              ? `${ep1Uuid}|${ep2Uuid}`
              : `${ep2Uuid}|${ep1Uuid}`;

          const sourceEp = episodeMap.get(
            ep1Uuid < ep2Uuid ? ep1Uuid : ep2Uuid,
          )!;
          const targetEp = episodeMap.get(
            ep1Uuid < ep2Uuid ? ep2Uuid : ep1Uuid,
          )!;

          if (!episodePairMap.has(pairKey)) {
            episodePairMap.set(pairKey, {
              source: sourceEp,
              target: targetEp,
              subjects: new Map(),
              predicates: new Map(),
              objects: new Map(),
            });
          }

          const pair = episodePairMap.get(pairKey)!;

          // Add this shared entity to the pair's collections
          const entityName =
            sourceEp.subjects.get(entityUuid) ||
            sourceEp.predicates.get(entityUuid) ||
            sourceEp.objects.get(entityUuid) ||
            targetEp.subjects.get(entityUuid) ||
            targetEp.predicates.get(entityUuid) ||
            targetEp.objects.get(entityUuid) ||
            "";

          if (
            sourceEp.subjects.has(entityUuid) ||
            targetEp.subjects.has(entityUuid)
          ) {
            pair.subjects.set(entityUuid, entityName);
          }
          if (
            sourceEp.predicates.has(entityUuid) ||
            targetEp.predicates.has(entityUuid)
          ) {
            pair.predicates.set(entityUuid, entityName);
          }
          if (
            sourceEp.objects.has(entityUuid) ||
            targetEp.objects.has(entityUuid)
          ) {
            pair.objects.set(entityUuid, entityName);
          }
        }
      }
    }

    logger.info(`Built ${episodePairMap.size} unique episode pairs`);

    // Step 4: Convert to final triplet format
    const triplets: RawTriplet[] = [];

    for (const [pairKey, data] of episodePairMap) {
      const subjects = Array.from(data.subjects.entries()).map(
        ([uuid, name]) => ({ uuid, name }),
      );
      const predicates = Array.from(data.predicates.entries()).map(
        ([uuid, name]) => ({ uuid, name }),
      );
      const objects = Array.from(data.objects.entries()).map(
        ([uuid, name]) => ({ uuid, name }),
      );

      const totalSharedEntities =
        subjects.length + predicates.length + objects.length;

      // Skip pairs with very few connections (noise reduction)
      if (totalSharedEntities < 2) continue;

      const subjectNames = subjects.map((s) => s.name).join(", ");
      const predicateNames = predicates.map((p) => p.name).join(", ");
      const objectNames = objects.map((o) => o.name).join(", ");

      triplets.push({
        sourceNode: {
          uuid: data.source.uuid,
          labels: ["Episode"],
          attributes: {
            nodeType: "Episode",
            content: data.source.content,
            episodeUuid: data.source.uuid,
            clusterId: data.source.clusterId,
          },
          name: data.source.content || data.source.uuid,
          clusterId: data.source.clusterId || undefined,
          createdAt: data.source.createdAt || "",
        },
        edge: {
          uuid: pairKey,
          type: "SHARES_ENTITIES_WITH",
          source_node_uuid: data.source.uuid,
          target_node_uuid: data.target.uuid,
          attributes: {
            totalSharedEntities,
            subjectCount: subjects.length,
            predicateCount: predicates.length,
            objectCount: objects.length,
            subjects,
            predicates,
            objects,
            subjectNames,
            predicateNames,
            objectNames,
          },
          createdAt: data.source.createdAt || "",
        },
        targetNode: {
          uuid: data.target.uuid,
          labels: ["Episode"],
          attributes: {
            nodeType: "Episode",
            content: data.target.content,
            episodeUuid: data.target.uuid,
            clusterId: data.target.clusterId,
          },
          name: data.target.content || data.target.uuid,
          clusterId: data.target.clusterId || undefined,
          createdAt: data.target.createdAt || "",
        },
      });
    }

    logger.info(
      `Returning ${triplets.length} final episode-episode connections`,
    );

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
