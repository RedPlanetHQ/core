/**
 * Shared types used across all providers
 */

export type Embedding = number[];

export interface GraphNode {
  uuid: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface GraphRelationship {
  uuid?: string;
  type: string;
  from: string;
  to: string;
  properties?: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface VectorItem {
  id: string;
  vector: Embedding;
  content: string;
  metadata?: Record<string, any>;
}

/**
 * Strict filter type for vector search
 * All fields are strongly typed for better type safety
 */
export interface VectorSearchFilter {
  userId: string;        // Required: Multi-tenancy filter
  labelIds?: string[];   // Optional: Filter by labels/spaces
  excludeIds?: string[]; // Optional: Exclude specific IDs from results
}

export interface SearchParams {
  vector: Embedding;
  limit?: number;
  threshold?: number;
  filter: VectorSearchFilter; // Required: Always need userId at minimum
  namespace?: string;
}

export interface VectorCapabilities {
  supportsMetadataFiltering: boolean;
  supportsNamespaces: boolean;
  maxBatchSize: number;
  supportsHybridSearch: boolean;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// Provider configuration types
export type GraphProviderType = "neo4j" | "falkordb" | "helix";
export type VectorProviderType = "pgvector" | "pgvector-prisma" | "turbopuffer" | "qdrant";
export type ModelProviderType = "vercel-ai";

export interface ProviderConfig {
  graph: {
    type: GraphProviderType;
    config: Record<string, any>;
  };
  vector: {
    type: VectorProviderType;
    config: Record<string, any>;
  };
  model: {
    type: ModelProviderType;
    config: Record<string, any>;
  };
}
