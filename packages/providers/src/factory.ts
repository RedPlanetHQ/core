/**
 * ProviderFactory - Creates and manages provider instances
 *
 * Singleton pattern - initialize once, use everywhere
 */

import type { ProviderConfig, GraphProviderType, VectorProviderType, ModelProviderType } from "./types";
import type { IGraphProvider } from "./graph/interface";
import type { IVectorProvider } from "./vector/interface";
import type { IModelProvider } from "./model/interface";

import { Neo4jGraphProvider, StubGraphProvider } from "./graph";
import { PgVectorProvider, StubVectorProvider } from "./vector";
import { StubModelProvider } from "./model";

export class ProviderFactory {
  private static graphProvider: IGraphProvider | null = null;
  private static vectorProvider: IVectorProvider | null = null;
  private static modelProvider: IModelProvider | null = null;
  private static schemaInitialized = false;
  private static vectorInfrastructureInitialized = false;

  /**
   * Initialize providers from config object
   */
  static initialize(config: ProviderConfig): void {
    this.graphProvider = this.createGraphProvider(config.graph);
    this.vectorProvider = this.createVectorProvider(config.vector);
    this.modelProvider = this.createModelProvider(config.model);
  }

  /**
   * Initialize providers from environment variables
   */
  static initializeFromEnv(options?: { prisma?: any }): void {
    const config: ProviderConfig = {
      graph: {
        type: (process.env.GRAPH_PROVIDER as GraphProviderType) || "neo4j",
        config: this.getGraphConfig(),
      },
      vector: {
        type: (process.env.VECTOR_PROVIDER as VectorProviderType) || "pgvector",
        config: this.getVectorConfig(options?.prisma),
      },
      model: {
        type: (process.env.MODEL_PROVIDER as ModelProviderType) || "vercel-ai",
        config: this.getModelConfig(),
      },
    };

    this.initialize(config);
  }

  private static createGraphProvider(config: {
    type: GraphProviderType;
    config: Record<string, any>;
  }): IGraphProvider {
    switch (config.type) {
      case "neo4j":
        return new Neo4jGraphProvider(config.config as { uri: string; username: string; password: string });
      case "falkordb":
      case "helix":
      default:
        throw new Error(`Unknown graph provider: ${config.type}`);
    }
  }

  private static createVectorProvider(config: {
    type: VectorProviderType;
    config: Record<string, any>;
  }): IVectorProvider {
    switch (config.type) {
      case "pgvector":
        return new PgVectorProvider({ prisma: config.config.prisma });
      case "turbopuffer":
      case "qdrant":
        // These are stubs for now
        return new StubVectorProvider(config.type);
      default:
        throw new Error(`Unknown vector provider: ${config.type}`);
    }
  }

  private static createModelProvider(config: {
    type: ModelProviderType;
    config: Record<string, any>;
  }): IModelProvider {
    // All model providers are stubs for now
    return new StubModelProvider(config.type);
  }

  private static getGraphConfig(): Record<string, any> {
    return {
      uri: process.env.NEO4J_URI || "bolt://localhost:7687",
      username: process.env.NEO4J_USERNAME || "neo4j",
      password: process.env.NEO4J_PASSWORD || "password",
      maxConnectionPoolSize: 50,
      embeddingModelSize: process.env.EMBEDDING_MODEL_SIZE || "1024",
    };
  }

  private static getVectorConfig(prisma?: any): Record<string, any> {
    const type = process.env.VECTOR_PROVIDER;
    console.log("Vector provider type:", type);
    switch (type) {
      case "pgvector":
        return {
          prisma,
          databaseUrl: process.env.DATABASE_URL,
        };
      case "turbopuffer":
        return {
          apiKey: process.env.TURBOPUFFER_API_KEY,
          namespace: process.env.TURBOPUFFER_NAMESPACE,
        };
      case "qdrant":
        return {
          url: process.env.QDRANT_URL,
          apiKey: process.env.QDRANT_API_KEY,
        };
      default:
        return {};
    }
  }

  private static getModelConfig(): Record<string, any> {
    return {
      chatProvider: process.env.MODEL_CHAT_PROVIDER || "openai",
      chatModel: process.env.MODEL_CHAT_MODEL || "gpt-4",
      embeddingProvider: process.env.MODEL_EMBEDDING_PROVIDER || "openai",
      embeddingModel: process.env.MODEL_EMBEDDING_MODEL || "text-embedding-3-small",
      embeddingDimension: parseInt(process.env.MODEL_EMBEDDING_DIMENSION || "1536"),
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OLLAMA_BASE_URL,
    };
  }

  /**
   * Get the graph provider instance
   */
  static getGraphProvider(): IGraphProvider {
    if (!this.graphProvider) {
      throw new Error(
        "ProviderFactory not initialized. Call ProviderFactory.initializeFromEnv() first."
      );
    }
    return this.graphProvider;
  }

  /**
   * Get the vector provider instance
   */
  static getVectorProvider(): IVectorProvider {
    if (!this.vectorProvider) {
      throw new Error(
        "ProviderFactory not initialized. Call ProviderFactory.initializeFromEnv() first."
      );
    }
    return this.vectorProvider;
  }

  /**
   * Get the model provider instance
   */
  static getModelProvider(): IModelProvider {
    if (!this.modelProvider) {
      throw new Error(
        "ProviderFactory not initialized. Call ProviderFactory.initializeFromEnv() first."
      );
    }
    return this.modelProvider;
  }

  /**
   * Initialize database schema (for graph providers that support it)
   */
  static async initializeSchemaOnce(): Promise<void> {
    if (this.schemaInitialized) return;

    const graphProvider = this.getGraphProvider();

    // Check if provider has schema initialization
    if ('initNeo4jSchemaOnce' in graphProvider) {
      await (graphProvider as any).initNeo4jSchemaOnce();
      this.schemaInitialized = true;
    }
  }

  /**
   * Initialize vector provider infrastructure (indexes, etc.)
   * Follows the same pattern as initializeSchemaOnce for graph providers
   * This method is idempotent and safe to call multiple times
   */
  static async initializeVectorInfrastructureOnce(): Promise<void> {
    if (this.vectorInfrastructureInitialized) return;

    const vectorProvider = this.getVectorProvider();

    // Check if provider has infrastructure initialization
    if ('initializeInfrastructure' in vectorProvider &&
        typeof vectorProvider.initializeInfrastructure === 'function') {
      const success = await vectorProvider.initializeInfrastructure();
      if (!success) {
        console.warn('[ProviderFactory] Vector infrastructure initialization failed, but continuing...');
      }
    }

    // Mark as initialized even if it failed to prevent retry loops
    this.vectorInfrastructureInitialized = true;
  }

  /**
   * Close all provider connections
   */
  static async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.graphProvider) {
      promises.push(this.graphProvider.close());
    }
    if (this.vectorProvider) {
      promises.push(this.vectorProvider.close());
    }

    await Promise.all(promises);

    // Reset initialization flags
    this.schemaInitialized = false;
    this.vectorInfrastructureInitialized = false;
  }
}
