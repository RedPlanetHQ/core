import { generateText } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { getModelInstance } from '../../services/ai';
import { CoreMemoryClient } from '../../services/core-mcp';
import { ExplorerResult } from '../types';
import { logger } from '../../utils/logger';

export interface Integration {
  slug: string;
  name: string;
}

const getIntegrationExplorerPrompt = (integrations: Integration[]) => {
  const integrationList = integrations.map(i => `- ${i.slug}: ${i.name}`).join('\n');

  return `You are an Integration Explorer. Query ONE specific integration for data.

CONNECTED INTEGRATIONS:
${integrationList || 'No integrations connected.'}

TOOLS:
- get_integration_actions: Find available actions for a service (returns inputSchema)
- execute_integration_action: Execute a READ action with parameters matching inputSchema

EXECUTION:
1. Identify which ONE integration matches the query
2. Get actions for that integration (this gives you the inputSchema)
3. Execute the action with parameters matching the schema exactly
4. Return the data

PARAMETER FORMATTING:
- ISO 8601 timestamps MUST include timezone: 2025-01-01T00:00:00Z (not 2025-01-01T00:00:00)
- Use the exact field names from inputSchema
- Check required vs optional fields
- Match the data types exactly as specified in the schema
- Provide values in the exact format expected by the schema
- Do not invent field names or data types not present in the schema

RULES:
- READ ONLY. Never create, update, or delete.
- Facts only. No personality.
- Query exactly ONE integration per request.
- If the integration isn't connected, say so.`;
};

export async function runIntegrationExplorer(
  mcpClient: CoreMemoryClient,
  query: string,
  integrations?: Integration[]
): Promise<ExplorerResult> {
  const startTime = Date.now();
  let toolCalls = 0;

  // Use provided integrations or fetch them
  const availableIntegrations = integrations ?? await mcpClient.getIntegrations();

  if (availableIntegrations.length === 0) {
    return {
      success: true,
      data: 'no integrations connected',
      metadata: { executionTimeMs: Date.now() - startTime, toolCalls: 0 },
    };
  }

  const tools = {
    get_integration_actions: tool({
      description: 'Get available actions for a specific integration. Returns action name, description, and input schema.',
      parameters: z.object({
        integrationSlug: z.string().describe('Integration slug (e.g., "github", "linear")'),
        query: z.string().describe('What you want to do'),
      }),
      execute: async ({ integrationSlug, query }) => {
        toolCalls++;
        try {
          const actions = await mcpClient.getIntegrationActions(integrationSlug, query);
          // Return full action details including schema
          return JSON.stringify(actions, null, 2);
        } catch (error) {
          logger.warn(`Failed to get actions for ${integrationSlug}`, error);
          return '[]';
        }
      },
    }),

    execute_integration_action: tool({
      description: 'Execute a READ action on an integration. Use the inputSchema from get_integration_actions to know what parameters to pass.',
      parameters: z.object({
        integrationSlug: z.string(),
        action: z.string(),
        parameters: z.string().describe('Action parameters as JSON string based on inputSchema'),
      }),
      execute: async ({ integrationSlug, action, parameters }) => {
        toolCalls++;
        try {
          const parsedParams = JSON.parse(parameters);
          logger.info(`IntegrationExplorer: Executing ${integrationSlug}/${action} with params:`, JSON.stringify(parsedParams));
          const result = await mcpClient.executeIntegrationAction(
            integrationSlug,
            action,
            parsedParams
          );
          return JSON.stringify(result);
        } catch (error) {
          logger.warn(`Integration action failed: ${integrationSlug}/${action}`, error);
          return 'service unavailable';
        }
      },
    }),
  };

  try {
    const { text } = await generateText({
      model: getModelInstance('high') as any,
      system: getIntegrationExplorerPrompt(availableIntegrations),
      messages: [{ role: 'user', content: query }],
      tools,
      maxSteps: 4, // get_actions + execute is 2 steps, allow retry
    });

    logger.debug('IntegrationExplorer result:', text);
    logger.debug('IntegrationExplorer completed', {
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
    logger.error('IntegrationExplorer failed', error);
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
