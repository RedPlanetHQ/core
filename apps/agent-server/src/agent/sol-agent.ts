import { generateText } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { getModelInstance } from '../services/ai';
import { CoreMemoryClient } from '../services/core-mcp';
import { getSolPrompt, ChannelType } from '../prompts';
import { runOrchestrator } from './orchestrator';
import { logger } from '../utils/logger';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SolAgentOptions {
  mcpClient: CoreMemoryClient;
  userMessage: string;
  channel: ChannelType;
  progressive?: boolean;
  onMessage?: (message: string) => Promise<void>;
  conversationHistory?: ConversationMessage[];
  sessionContext?: string;
}

export interface SolAgentResult {
  messages: string[];
  executionTimeMs: number;
}

/**
 * Sol Agent
 *
 * Unified agent with progressive toggle:
 * - progressive=true: Send messages sequentially (WhatsApp)
 * - progressive=false: Return all messages at once (Email)
 *
 * Both modes use generateText (no word-by-word streaming).
 * Sol uses ---MSG--- format to break responses into chunks.
 */
export async function runSolAgent(options: SolAgentOptions): Promise<SolAgentResult> {
  const { mcpClient, userMessage, channel, progressive = false, onMessage, conversationHistory = [], sessionContext } = options;
  const startTime = Date.now();
  const messages: string[] = [];

  // Build system prompt with session context if available
  let systemPrompt = getSolPrompt(channel);
  if (sessionContext) {
    systemPrompt += `\n\n<session_context>\n${sessionContext}\n</session_context>`;
  }

  // Build tools
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    gather_context: tool({
      description: 'Gather information from memory and integrations to answer the user. Use this when you need data.',
      parameters: z.object({
        query: z.string().describe('What information to gather'),
      }),
      execute: async ({ query }) => {
        logger.info(`Sol: Gathering context for: ${query}`);
        const result = await runOrchestrator(mcpClient, query);
        return result.context || 'nothing found';
      },
    }),
  };

  // Add acknowledge tool for progressive mode
  if (progressive && onMessage) {
    tools.acknowledge = tool({
      description: 'Send a quick ack before gathering data. Call FIRST.',
      parameters: z.object({
        message: z.string().describe('Brief, varied ack. Can reference what they asked. "checking calendar." "pulling that up." "looking at your inbox." "gimme a sec." "on it." Keep it natural, not robotic.'),
      }),
      execute: async ({ message }) => {
        logger.info(`Sol: Acknowledging: ${message}`);
        await onMessage(message);
        messages.push(message);
        return 'acknowledged';
      },
    });
  }

  try {
    // Build messages array with history + current message
    const aiMessages = [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    // Always use generateText (no streaming)
    const { text: finalText } = await generateText({
      model: getModelInstance() as any,
      system: systemPrompt,
      messages: aiMessages,
      tools,
      maxSteps: 3,
    });

    // Parse response into messages using ---MSG--- format
    const parsedMessages = parseMessages(finalText);

    // For progressive mode, send each response message sequentially
    // (acknowledgment already sent via tool)
    if (progressive && onMessage) {
      for (const msg of parsedMessages) {
        logger.info(`WhatsApp [progressive]: ${msg.substring(0, 50)}...`);
        await onMessage(msg);
      }
    }

    // Add all response messages to result
    messages.push(...parsedMessages);

    logger.info('SolAgent completed', {
      executionTimeMs: Date.now() - startTime,
      messageCount: messages.length,
      progressive,
    });

    return {
      messages,
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    logger.error('SolAgent failed', error);
    const errorMsg = "something's not working. try again in a bit.";
    if (progressive && onMessage) {
      await onMessage(errorMsg);
    }
    return {
      messages: [errorMsg],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Parse response into separate messages using ---MSG--- format
 */
function parseMessages(text: string): string[] {
  if (!text) return [];

  // Try to parse ---MSG--- format
  if (text.includes('---MSG---')) {
    const parts = text
      .split(/---MSG---|---END---/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== '---MSG---' && p !== '---END---');

    if (parts.length > 0) return parts;
  }

  // Fallback: split by double newlines
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length > 1) {
    return paragraphs.slice(0, 4); // Max 4 messages
  }

  // Single message
  return [text.trim()];
}
