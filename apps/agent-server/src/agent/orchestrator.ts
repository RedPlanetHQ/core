import { generateText } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { getModelInstance } from '../services/ai';
import { CoreMemoryClient } from '../services/core-mcp';
import { runMemoryExplorer, runIntegrationExplorer, type Integration } from './explorers';
import { logger } from '../utils/logger';

const getOrchestratorPrompt = (integrations: Integration[]) => {
  const integrationList = integrations.length > 0
    ? integrations.map(i => `- ${i.slug}`).join('\n')
    : 'None connected';

  return `You are an orchestrator. Gather information to answer the user's question.

CONNECTED INTEGRATIONS:
${integrationList}

TOOLS:
- memory_search: Search past conversations, user preferences, decisions
- integration_query: Query a connected service (specify which one)

EXAMPLES:

Query: "get my high priority issues"
Connected: github, linear
Action: [call both in parallel]
  integration_query({ integration: "github", query: "high priority issues assigned to me" })
  integration_query({ integration: "linear", query: "high priority or urgent issues assigned to me" })

Query: "what's on my calendar today"
Connected: google-calendar, github, linear
Action: [only calendar is relevant]
  integration_query({ integration: "google-calendar", query: "today's events" })

Query: "any updates on the auth bug"
Connected: github, linear
Action: [check memory for context, then both issue trackers]
  memory_search({ query: "auth bug discussions" })
  integration_query({ integration: "github", query: "auth bug issues or PRs" })
  integration_query({ integration: "linear", query: "auth bug issues" })

Query: "check my github PRs"
Connected: github, linear
Action: [user specified github]
  integration_query({ integration: "github", query: "my open PRs" })

Query: "what did we decide about pricing"
Connected: github, linear
Action: [this is about past decisions, use memory]
  memory_search({ query: "pricing decisions and discussions" })

RULES:
- Gather information only. No personality.
- Call multiple tools in parallel when data could be in multiple places.
- Return raw facts. Another agent will synthesize.
- If nothing found, say so.`;
};

export interface OrchestratorResult {
  context: string;
  executionTimeMs: number;
  toolCalls: number;
}

export async function runOrchestrator(
  mcpClient: CoreMemoryClient,
  userMessage: string
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  let toolCalls = 0;

  // Load integrations here - orchestrator owns this
  const integrations = await mcpClient.getIntegrations().catch(() => []);
  logger.info(`Orchestrator: Loaded ${integrations.length} integrations`);

  const tools = {
    memory_search: tool({
      description: 'Search past conversations, user preferences, stored knowledge',
      parameters: z.object({
        query: z.string().describe('What to search for'),
      }),
      execute: async ({ query }) => {
        toolCalls++;
        logger.info(`Orchestrator: memory search - ${query}`);
        const result = await runMemoryExplorer(mcpClient, query);
        return result.success ? result.data : 'nothing found';
      },
    }),

    integration_query: tool({
      description: 'Query a connected integration for current data',
      parameters: z.object({
        integration: z.string().describe('Which integration to query (e.g., github, linear, google-calendar)'),
        query: z.string().describe('What data to get'),
      }),
      execute: async ({ integration, query }) => {
        toolCalls++;
        logger.info(`Orchestrator: integration query - ${integration}: ${query}`);
        // Pass query with integration hint
        const result = await runIntegrationExplorer(
          mcpClient,
          `${query} from ${integration}`,
          integrations
        );
        return result.success ? result.data : 'service unavailable';
      },
    }),
  };

  try {
    const { text } = await generateText({
      model: getModelInstance('high') as any,
      system: getOrchestratorPrompt(integrations),
      messages: [{ role: 'user', content: userMessage }],
      tools,
      maxSteps: 8,
    });

    logger.info('Orchestrator completed', {
      executionTimeMs: Date.now() - startTime,
      toolCalls,
    });

    return {
      context: text,
      executionTimeMs: Date.now() - startTime,
      toolCalls,
    };
  } catch (error) {
    logger.error('Orchestrator failed', error);
    return {
      context: '',
      executionTimeMs: Date.now() - startTime,
      toolCalls,
    };
  }
}
