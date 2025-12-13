/**
 * StubModelProvider - Placeholder for model providers
 */

import { IModelProvider } from "./interface";
import type { Embedding, ChatMessage, ChatOptions } from "../types";

export class StubModelProvider implements IModelProvider {
  private providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  async generateEmbedding(text: string): Promise<Embedding> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async batchGenerateEmbeddings(texts: string[]): Promise<Embedding[]> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  getEmbeddingDimension(): number {
    return 1536; // Default
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async generateObject<T>(params: {
    schema: any;
    prompt: string;
    system?: string;
  }): Promise<T> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  getProviderName(): string {
    return this.providerName;
  }

  getModelName(): string {
    return "stub";
  }

  getEmbeddingModelName(): string {
    return "stub";
  }

  async ping(): Promise<boolean> {
    return false;
  }
}
