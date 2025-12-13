/**
 * IModelProvider - Interface for AI model providers
 */

import type { Embedding, ChatMessage, ChatOptions } from "../types";

export interface IModelProvider {
  /**
   * Generate embedding for a single text
   */
  generateEmbedding(text: string): Promise<Embedding>;

  /**
   * Generate embeddings for multiple texts
   */
  batchGenerateEmbeddings(texts: string[]): Promise<Embedding[]>;

  /**
   * Get embedding dimension (e.g., 1536 for OpenAI ada-002)
   */
  getEmbeddingDimension(): number;

  /**
   * Chat completion
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /**
   * Generate structured object using schema
   */
  generateObject<T>(params: {
    schema: any; // Zod schema
    prompt: string;
    system?: string;
  }): Promise<T>;

  /**
   * Get provider name
   */
  getProviderName(): string;

  /**
   * Get model name
   */
  getModelName(): string;

  /**
   * Get embedding model name
   */
  getEmbeddingModelName(): string;

  /**
   * Health check
   */
  ping(): Promise<boolean>;
}
