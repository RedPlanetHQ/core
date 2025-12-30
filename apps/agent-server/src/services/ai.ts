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

function getModelInstance() {
  const model = process.env.MODEL || process.env.AI_MODEL || 'gpt-4o';
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
