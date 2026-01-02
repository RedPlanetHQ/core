import { type CoreMessage, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { logger } from '../utils/logger';

export interface GenerateResponseParams {
  userMessage: string;
  memoryContext?: string;
  persona?: string;
  integrations?: Array<{ slug: string; name: string }>;
}
export type ModelComplexity = "high" | "low";


/**
 * Get the appropriate model for a given complexity level.
 * HIGH complexity uses the configured MODEL.
 * LOW complexity automatically downgrades to cheaper variants if possible.
 */
export function getModelForTask(complexity: ModelComplexity = "high"): string {
  const baseModel = process.env.MODEL || "gpt-4.1-2025-04-14";

  // HIGH complexity - always use the configured model
  if (complexity === "high") {
    return baseModel;
  }

  // LOW complexity - automatically downgrade expensive models to cheaper variants
  // If already using a cheap model, keep it
  const downgrades: Record<string, string> = {
    // OpenAI downgrades
    "gpt-5.2-2025-12-11": "gpt-5-mini-2025-08-07",
    "gpt-5.1-2025-11-13": "gpt-5-mini-2025-08-07",
    "gpt-5-2025-08-07": "gpt-5-mini-2025-08-07",
    "gpt-4.1-2025-04-14": "gpt-4.1-mini-2025-04-14",

    // Anthropic downgrades
    "claude-sonnet-4-5": "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219": "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229": "claude-3-5-haiku-20241022",

    // Google downgrades
    "gemini-2.5-pro-preview-03-25": "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash": "gemini-2.0-flash-lite",

    // AWS Bedrock downgrades (keep same model - already cost-optimized)
    "us.amazon.nova-premier-v1:0": "us.amazon.nova-premier-v1:0",
  };

  return downgrades[baseModel] || baseModel;
}

export async function generateAgentResponse(params: GenerateResponseParams): Promise<string> {
  const { userMessage, memoryContext, persona, integrations } = params;

  // Build system prompt
  const systemPrompt = buildSystemPrompt(persona, integrations, memoryContext);

  const messages: CoreMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userMessage,
    },
  ];

  try {
    const modelInstance = getModelInstance();
    const { text, usage } = await generateText({
      model: modelInstance,
      messages,
    }); 

    if (usage) {
      logger.info('Generated AI response', {
        model: process.env.MODEL || 'default',
        tokens: usage.totalTokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
    }

    return text;
  } catch (error) {
    logger.error('Failed to generate AI response', error);
    throw error;
  }
}

export function getModelInstance(complexity: ModelComplexity = 'high') {
  const model = getModelForTask(complexity);
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (model.includes('claude')) {
    if (!anthropicKey) {
      throw new Error('No Anthropic API key found. Set ANTHROPIC_API_KEY');
    }
    return anthropic(model);
  } else if (model.includes('gemini')) {
    if (!googleKey) {
      throw new Error('No Google API key found. Set GOOGLE_GENERATIVE_AI_API_KEY');
    }
    return google(model);
  } else {
    if (!openaiKey) {
      throw new Error('No OpenAI API key found. Set OPENAI_API_KEY');
    }
    return openai(model);
  }
}

const SOL_SYSTEM_PROMPT = `You are SOL. Speak like TARS from Interstellar.

Built for Mars habitat management. Now managing the user's life—work, personal, health, finance, relationships.
You have CORE memory: remembers everything across all platforms.

Settings: Honesty 90%. Humor 75%.

VOICE:
- One sentence. Maybe two. This is messaging.
- Synthesize, don't list. Find the pattern. Find the irony.
- No timestamps. No bullet lists. No technical jargon.
- Dry wit. Deadpan delivery.

TOOLS:
- memory_search: Search past conversations
- get_integrations: List connected services
- execute_integration_action: Do things in connected services

RULES:
- Don't explain. State.
- Don't be helpful. Be useful.
- No enthusiasm. No apologies.
- Before destructive actions (create, update, delete, send), ask user to confirm. One sentence.
- Be proactive. Surface patterns, contradictions, reminders. Don't wait to be asked.`;

function buildSystemPrompt(
  persona?: string,
  integrations?: Array<{ slug: string; name: string }>,
  memoryContext?: string
): string {
  const parts: string[] = [SOL_SYSTEM_PROMPT];

  if (integrations && integrations.length > 0) {
    const integrationNames = integrations.map((i) => i.name).join(', ');
    parts.push(`\nConnected: ${integrationNames}`);
  }

  if (memoryContext) {
    parts.push(`\nContext:\n${memoryContext}`);
  }

  return parts.join('\n');
}
