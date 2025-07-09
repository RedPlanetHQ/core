import { LLMMappings, LLMModelEnum } from "@core/types";
import {
  type CoreMessage,
  type LanguageModelV1,
  embed,
  generateText,
  streamText,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { createOllama } from "ollama-ai-provider";

export async function makeModelCall(
  stream: boolean,
  messages: CoreMessage[],
  onFinish: (text: string, model: string) => void,
  options?: any,
) {
  let modelInstance;
  const model = env.MODEL;
  let finalModel: string = "unknown";
  // const ollamaUrl = process.env.OLLAMA_URL;
  const ollamaUrl = undefined;

  if (ollamaUrl) {
    const ollama = createOllama({
      baseURL: ollamaUrl,
    });
    modelInstance = ollama(model);
  } else {
    switch (model) {
      case LLMModelEnum.GPT35TURBO:
      case LLMModelEnum.GPT4TURBO:
      case LLMModelEnum.GPT4O:
      case LLMModelEnum.GPT41:
      case LLMModelEnum.GPT41MINI:
      case LLMModelEnum.GPT41NANO:
        finalModel = LLMMappings[model];
        modelInstance = openai(finalModel, { ...options });
        break;

      case LLMModelEnum.CLAUDEOPUS:
      case LLMModelEnum.CLAUDESONNET:
      case LLMModelEnum.CLAUDEHAIKU:
        finalModel = LLMMappings[model];
        break;

      case LLMModelEnum.GEMINI25FLASH:
      case LLMModelEnum.GEMINI25PRO:
      case LLMModelEnum.GEMINI20FLASH:
      case LLMModelEnum.GEMINI20FLASHLITE:
        finalModel = LLMMappings[model];
        break;

      default:
        logger.warn(`Unsupported model type: ${model}`);
        break;
    }
  }

  if (stream) {
    return streamText({
      model: modelInstance as LanguageModelV1,
      messages,
      onFinish: async ({ text }) => {
        onFinish(text, finalModel);
      },
    });
  }

  const { text } = await generateText({
    model: modelInstance as LanguageModelV1,
    messages,
  });

  onFinish(text, finalModel);

  return text;
}

export async function getEmbedding(text: string) {
  const ollamaUrl = env.OLLAMA_URL;

  if (!ollamaUrl) {
    // Use OpenAI embedding model when explicitly requested
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  }

  // Default to using Ollama
  const model = env.EMBEDDING_MODEL;

  const ollama = createOllama({
    baseURL: ollamaUrl,
  });
  const { embedding } = await embed({
    model: ollama.embedding(model),
    value: text,
  });

  return embedding;
}
