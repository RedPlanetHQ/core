import { generateText } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { getModelInstance } from '../../services/ai';
import { CoreMemoryClient } from '../../services/core-mcp';
import { ExplorerResult } from '../types';
import { logger } from '../../utils/logger';

const MEMORY_EXPLORER_PROMPT = `You are a Memory Explorer. Find relevant context from user's history.

TOOLS:
- memory_search: Search past conversations, decisions, preferences
- memory_about_user: Get user's background, preferences, work patterns

EXECUTION:
1. Understand what context would help answer the query
2. Call appropriate tools - can call multiple if needed
3. Return concise summary of findings

RULES:
- Facts only. No personality, no commentary.
- If uncertain what to search, try multiple queries in parallel.
- Include temporal context when relevant (when something was discussed).
- Return empty if nothing relevant found - don't make up context.`;

export async function runMemoryExplorer(
  mcpClient: CoreMemoryClient,
  query: string
): Promise<ExplorerResult> {
  const startTime = Date.now();
  let toolCalls = 0;

  const tools = {
    memory_search: tool({
      description: 'Search memory for relevant context using semantic queries',
      parameters: z.object({
        query: z.string().describe('Semantic search query'),
      }),
      execute: async ({ query }) => {
        toolCalls++;
        try {
          logger.info(`MemoryExplorer: Searching memory with query: ${query}`);
          const result = await mcpClient.searchMemory(query);
          logger.info(`MemoryExplorer: Search result length: ${result.length}`);
          return result || 'nothing found';
        } catch (error) {
          logger.warn('Memory search failed', error);
          return 'nothing found';
        }
      },
    }),

    memory_about_user: tool({
      description: 'Get user persona, preferences, and background',
      parameters: z.object({}),
      execute: async () => {
        toolCalls++;
        try {
          logger.info('MemoryExplorer: Getting user persona');
          const result = await mcpClient.getUserPersona();
          logger.info(`MemoryExplorer: Persona result length: ${result.length}`);
          return result || 'no user info available';
        } catch (error) {
          logger.warn('Failed to get user persona', error);
          return 'no user info available';
        }
      },
    }),
  };

  try {
    const { text } = await generateText({
      model: getModelInstance('low') as any,
      system: MEMORY_EXPLORER_PROMPT,
      messages: [{ role: 'user', content: query }],
      tools,
      maxSteps: 3, // Reduced for speed
    });

    logger.debug('MemoryExplorer completed', {
      executionTimeMs: Date.now() - startTime,
      toolCalls,
    });

    return {
      success: true,
      data: text,
      metadata: {
        executionTimeMs: Date.now() - startTime,
        toolCalls,
      },
    };
  } catch (error) {
    logger.error('MemoryExplorer failed', error);
    return {
      success: false,
      data: '',
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        executionTimeMs: Date.now() - startTime,
        toolCalls,
      },
    };
  }
}
