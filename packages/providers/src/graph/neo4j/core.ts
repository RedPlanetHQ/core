/**
 * Neo4j core infrastructure - connection, schema, and base query operations
 */

import neo4j, { Driver, Session } from "neo4j-driver";
import type { Neo4jLogger, Neo4jConfig, RawTriplet } from "./types";

export class Neo4jCore {
  protected driver: Driver;
  public logger?: Neo4jLogger;
  protected embeddingModelSize: string;
  protected schemaInitialized = false;

  constructor(config: Neo4jConfig) {
    this.logger = config.logger;
    this.embeddingModelSize = config.embeddingModelSize || "1024";

    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
      {
        maxConnectionPoolSize: config.maxConnectionPoolSize || 50,
        logging: config.logger ? {
          level: "info",
          logger: (level, message) => {
            config.logger!.info(message);
          },
        } : undefined,
      }
    );
  }

  /**
   * Execute a Cypher query with logging
   */
  async runQuery<T = any>(
    cypher: string,
    params?: Record<string, any>
  ): Promise<T[]> {
    const session: Session = this.driver.session();
    try {
      const result = await session.run(cypher, params || {});
      return result.records as T[];
    } catch (error) {
      if (this.logger) {
        this.logger.error(`Error running Cypher query: ${cypher}`, { error });
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get all nodes and relationships for a user
   */
  async getAllNodesForUser(userId: string): Promise<any[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n)-[r]->(m)
         WHERE n.userId = $userId OR m.userId = $userId
         RETURN n, r, m`,
        { userId }
      );
      return result.records;
    } catch (error) {
      if (this.logger) {
        this.logger.error(`Error getting nodes for user ${userId}`, { error });
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Initialize Neo4j schema (indexes, constraints, etc.)
   */
  async initializeSchema(): Promise<boolean> {
    try {
      if (this.logger) {
        this.logger.info("Initialising neo4j schema");
      }

      // Create constraints for unique IDs
      await this.runQuery(
        "CREATE CONSTRAINT episode_uuid IF NOT EXISTS FOR (n:Episode) REQUIRE n.uuid IS UNIQUE"
      );
      await this.runQuery(
        "CREATE CONSTRAINT entity_uuid IF NOT EXISTS FOR (n:Entity) REQUIRE n.uuid IS UNIQUE"
      );
      await this.runQuery(
        "CREATE CONSTRAINT statement_uuid IF NOT EXISTS FOR (n:Statement) REQUIRE n.uuid IS UNIQUE"
      );
      await this.runQuery(
        "CREATE CONSTRAINT cluster_uuid IF NOT EXISTS FOR (n:Cluster) REQUIRE n.uuid IS UNIQUE"
      );

      // Create indexes for better query performance
      await this.runQuery(
        "CREATE INDEX episode_valid_at IF NOT EXISTS FOR (n:Episode) ON (n.validAt)"
      );
      await this.runQuery(
        "CREATE INDEX statement_valid_at IF NOT EXISTS FOR (n:Statement) ON (n.validAt)"
      );
      await this.runQuery(
        "CREATE INDEX statement_invalid_at IF NOT EXISTS FOR (n:Statement) ON (n.invalidAt)"
      );
      await this.runQuery(
        "CREATE INDEX statement_cluster_id IF NOT EXISTS FOR (n:Statement) ON (n.clusterId)"
      );
      await this.runQuery(
        "CREATE INDEX entity_name IF NOT EXISTS FOR (n:Entity) ON (n.name)"
      );
      await this.runQuery(
        "CREATE INDEX entity_uuid IF NOT EXISTS FOR (n:Entity) ON (n.uuid)"
      );
      await this.runQuery(
        "CREATE INDEX entity_type IF NOT EXISTS FOR (n:Entity) ON (n.type)"
      );
      await this.runQuery(
        "CREATE INDEX entity_user_id IF NOT EXISTS FOR (n:Entity) ON (n.userId)"
      );
      await this.runQuery(
        "CREATE INDEX statement_user_id IF NOT EXISTS FOR (n:Statement) ON (n.userId)"
      );
      await this.runQuery(
        "CREATE INDEX cluster_user_id IF NOT EXISTS FOR (n:Cluster) ON (n.userId)"
      );
      await this.runQuery(
        "CREATE INDEX cluster_aspect_type IF NOT EXISTS FOR (n:Cluster) ON (n.aspectType)"
      );

      await this.runQuery(
        "CREATE INDEX statement_user_invalid IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.invalidAt)"
      );
      await this.runQuery(
        "CREATE INDEX statement_user_uuid IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.uuid)"
      );
      await this.runQuery(
        "CREATE INDEX entity_user_uuid IF NOT EXISTS FOR (n:Entity) ON (n.userId, n.uuid)"
      );
      await this.runQuery(
        "CREATE INDEX episode_user_uuid IF NOT EXISTS FOR (n:Episode) ON (n.userId, n.uuid)"
      );
      await this.runQuery(
        "CREATE INDEX episode_user_id IF NOT EXISTS FOR (n:Episode) ON (n.userId)"
      );

      // Composite temporal index for efficient time-range queries
      await this.runQuery(
        "CREATE INDEX statement_user_temporal IF NOT EXISTS FOR (n:Statement) ON (n.userId, n.validAt, n.invalidAt)"
      );

      // Session-based episode lookups
      await this.runQuery(
        "CREATE INDEX episode_session_id IF NOT EXISTS FOR (n:Episode) ON (n.sessionId)"
      );

      // Composite index for entity name + userId (for exact match lookups)
      await this.runQuery(
        "CREATE INDEX entity_name_user IF NOT EXISTS FOR (n:Entity) ON (n.name, n.userId)"
      );

      // Composite index for session + userId (for previous episodes lookup)
      await this.runQuery(
        "CREATE INDEX episode_session_user IF NOT EXISTS FOR (n:Episode) ON (n.sessionId, n.userId)"
      );

      // Create vector indexes for semantic search (if using Neo4j 5.0+)
      await this.runQuery(`
        CREATE VECTOR INDEX entity_embedding IF NOT EXISTS FOR (n:Entity) ON n.nameEmbedding
        OPTIONS {indexConfig: {\`vector.dimensions\`: ${this.embeddingModelSize}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
      `);

      await this.runQuery(`
        CREATE VECTOR INDEX statement_embedding IF NOT EXISTS FOR (n:Statement) ON n.factEmbedding
        OPTIONS {indexConfig: {\`vector.dimensions\`: ${this.embeddingModelSize}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
      `);

      await this.runQuery(`
        CREATE VECTOR INDEX episode_embedding IF NOT EXISTS FOR (n:Episode) ON n.contentEmbedding
        OPTIONS {indexConfig: {\`vector.dimensions\`: ${this.embeddingModelSize}, \`vector.similarity_function\`: 'cosine', \`vector.hnsw.ef_construction\`: 400, \`vector.hnsw.m\`: 32}}
      `);

      // Create fulltext indexes for BM25 search
      await this.runQuery(`
        CREATE FULLTEXT INDEX statement_fact_index IF NOT EXISTS
        FOR (n:Statement) ON EACH [n.fact]
        OPTIONS {
          indexConfig: {
            \`fulltext.analyzer\`: 'english'
          }
        }
      `);

      await this.runQuery(`
        CREATE FULLTEXT INDEX entity_name_index IF NOT EXISTS
        FOR (n:Entity) ON EACH [n.name]
        OPTIONS {
          indexConfig: {
            \`fulltext.analyzer\`: 'english'
          }
        }
      `);

      // Create relationship indexes for faster traversal
      await this.runQuery(`
        CREATE INDEX rel_has_provenance IF NOT EXISTS
        FOR ()-[r:HAS_PROVENANCE]-()
        ON (r.userId)
      `);

      await this.runQuery(`
        CREATE INDEX rel_has_subject IF NOT EXISTS
        FOR ()-[r:HAS_SUBJECT]-()
        ON (r.userId)
      `);

      await this.runQuery(`
        CREATE INDEX rel_has_object IF NOT EXISTS
        FOR ()-[r:HAS_OBJECT]-()
        ON (r.userId)
      `);

      await this.runQuery(`
        CREATE INDEX rel_has_predicate IF NOT EXISTS
        FOR ()-[r:HAS_PREDICATE]-()
        ON (r.userId)
      `);

      if (this.logger) {
        this.logger.info("Neo4j schema initialized successfully");
      }
      return true;
    } catch (error) {
      if (this.logger) {
        this.logger.error("Failed to initialize Neo4j schema", { error });
      }
      return false;
    }
  }

  /**
   * Initialize schema once (idempotent)
   */
  async initNeo4jSchemaOnce(): Promise<void> {
    if (this.schemaInitialized) return;

    const session = this.driver.session();

    try {
      // Check if schema already exists
      const result = await session.run(`
        SHOW INDEXES YIELD name WHERE name = "entity_name" RETURN name
      `);

      if (result.records.length === 0) {
        // Run schema creation
        await this.initializeSchema();
      }

      this.schemaInitialized = true;
    } catch (e: any) {
      if (this.logger) {
        this.logger.error("Error in initialising schema", { error: e });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Test the connection
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.driver.getServerInfo();
      if (this.logger) {
        this.logger.info("Connected to Neo4j database");
      }
      return true;
    } catch (error) {
      if (this.logger) {
        this.logger.error("Failed to connect to Neo4j database");
      }
      return false;
    }
  }

  /**
   * Get the underlying Neo4j driver (for advanced use cases)
   */
  getDriver(): Driver {
    return this.driver;
  }

  async close(): Promise<void> {
    await this.driver.close();
    if (this.logger) {
      this.logger.info("Neo4j driver closed");
    }
  }

  getProviderName(): string {
    return "neo4j";
  }

  async ping(): Promise<boolean> {
    try {
      await this.runQuery("RETURN 1 as ping");
      return true;
    } catch (error) {
      if (this.logger) {
        this.logger.error("Neo4j ping failed", { error });
      }
      return false;
    }
  }

  supportsEmbeddings(): boolean {
    return true; // Neo4j stores embeddings as float arrays
  }
}
