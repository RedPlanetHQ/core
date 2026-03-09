/**
 * VercelAIModelProvider - IModelProvider implementation wrapping Vercel AI SDK
 *
 * Supports OpenAI, Anthropic, and Google models via the unified Vercel AI SDK.
 * Model provider is auto-detected from the model name prefix.
 */

import {
  embed,
  embedMany,
  generateText,
  generateObject as aiGenerateObject,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

import type { IModelProvider } from "./interface";
import type { Embedding, ChatMessage, ChatOptions } from "../types";

export interface VercelAIModelProviderConfig {
  chatModel: string;
  embeddingModel: string;
  embeddingDimension: number;
  apiKey?: string;
  baseURL?: string;
}

/**
 * Resolve a chat/language model instance from a model name string.
 * Detection by prefix:
 *   "claude-"  → Anthropic
 *   "gemini-"  → Google
 *   "gpt-" / "o1-" / "o3-" or default → OpenAI
 */
function resolveLanguageModel(modelName: string) {
  if (modelName.startsWith("claude-")) {
    return anthropic(modelName);
  }
  if (modelName.startsWith("gemini-")) {
    return google(modelName);
  }
  // gpt-*, o1-*, o3-*, or any other model defaults to OpenAI
  return openai(modelName);
}

/**
 * Resolve an embedding model instance from a model name string.
 */
function resolveEmbeddingModel(modelName: string) {
  if (modelName.startsWith("claude-")) {
    // Anthropic does not currently offer embedding models via AI SDK,
    // but we keep the branch for forward compatibility.
    return (anthropic as any).embedding(modelName);
  }
  if (modelName.startsWith("gemini-")) {
    return (google as any).embedding(modelName);
  }
  return openai.embedding(modelName);
}

/**
 * Detect the provider name from a model string.
 */
function detectProviderName(modelName: string): string {
  if (modelName.startsWith("claude-")) return "anthropic";
  if (modelName.startsWith("gemini-")) return "google";
  if (
    modelName.startsWith("gpt-") ||
    modelName.startsWith("o1-") ||
    modelName.startsWith("o3-")
  ) {
    return "openai";
  }
  return "openai";
}

export class VercelAIModelProvider implements IModelProvider {
  private config: VercelAIModelProviderConfig;

  constructor(config: VercelAIModelProviderConfig) {
    this.config = config;
  }

  async generateEmbedding(text: string): Promise<Embedding> {
    const model = resolveEmbeddingModel(this.config.embeddingModel);
    const { embedding } = await embed({
      model,
      value: text,
    });
    return embedding;
  }

  async batchGenerateEmbeddings(texts: string[]): Promise<Embedding[]> {
    const model = resolveEmbeddingModel(this.config.embeddingModel);
    const { embeddings } = await embedMany({
      model,
      values: texts,
    });
    return embeddings;
  }

  getEmbeddingDimension(): number {
    return this.config.embeddingDimension;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string> {
    const model = resolveLanguageModel(this.config.chatModel);
    const { text } = await generateText({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
      ...(options?.maxTokens !== undefined && {
        maxTokens: options.maxTokens,
      }),
    });
    return text;
  }

  async generateObject<T>(params: {
    schema: any;
    prompt: string;
    system?: string;
  }): Promise<T> {
    const model = resolveLanguageModel(this.config.chatModel);
    const { object } = await aiGenerateObject({
      model,
      schema: params.schema,
      prompt: params.prompt,
      ...(params.system && { system: params.system }),
    });
    return object as T;
  }

  getProviderName(): string {
    return detectProviderName(this.config.chatModel);
  }

  getModelName(): string {
    return this.config.chatModel;
  }

  getEmbeddingModelName(): string {
    return this.config.embeddingModel;
  }

  async ping(): Promise<boolean> {
    try {
      await this.generateEmbedding("ping");
      return true;
    } catch {
      return false;
    }
  }
}
