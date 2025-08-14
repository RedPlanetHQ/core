import {
  type CoreMessage,
  type LanguageModelV1,
  embed,
  generateText,
  streamText,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";

import { createOllama, type OllamaProvider } from "ollama-ai-provider";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export async function makeModelCall(
  stream: boolean,
  messages: CoreMessage[],
  onFinish: (text: string, model: string) => void,
  options?: any,
) {
  let modelInstance;
  const model = process.env.MODEL as any;
  const ollamaUrl = process.env.OLLAMA_URL;
  let ollama: OllamaProvider | undefined;

  if (ollamaUrl) {
    ollama = createOllama({
      baseURL: ollamaUrl,
    });
  }

  switch (model) {
    case "gpt-4.1-2025-04-14":
    case "gpt-4.1-mini-2025-04-14":
    case "gpt-4.1-nano-2025-04-14":
      modelInstance = openai(model, { ...options });
      break;

    case "claude-3-7-sonnet-20250219":
    case "claude-3-opus-20240229":
    case "claude-3-5-haiku-20241022":
      modelInstance = anthropic(model, { ...options });
      break;

    case "gemini-2.5-flash-preview-04-17":
    case "gemini-2.5-pro-preview-03-25":
    case "gemini-2.0-flash":
    case "gemini-2.0-flash-lite":
      modelInstance = google(model, { ...options });
      break;

    default:
      if (ollama) {
        modelInstance = ollama(model);
      }
      logger.warn(`Unsupported model type: ${model}`);
      break;
  }

  if (stream) {
    return streamText({
      model: modelInstance as LanguageModelV1,
      messages,
      onFinish: async ({ text }) => {
        onFinish(text, model);
      },
    });
  }

  const { text } = await generateText({
    model: modelInstance as LanguageModelV1,
    messages,
  });

  onFinish(text, model);

  return text;
}

export async function getEmbedding(text: string) {
  const ollamaUrl = process.env.OLLAMA_URL;

  // Default to using Ollama
  const model = process.env.EMBEDDING_MODEL;

  if (model === "text-embedding-3-small") {
    // Use OpenAI embedding model when explicitly requested
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  }

  const ollama = createOllama({
    baseURL: ollamaUrl,
  });
  const { embedding } = await embed({
    model: ollama.embedding(model as string),
    value: text,
  });

  return embedding;
}
