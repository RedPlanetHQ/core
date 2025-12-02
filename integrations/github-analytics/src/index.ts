import { integrationCreate } from './account-create';
import { getTools, callTool } from './mcp';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();
      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      if (!config?.access_token) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: No access token provided in config',
            },
          ],
          isError: true,
        };
      }

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return [{
        type: 'message',
        data: { message: `The event payload type is ${eventPayload.event}` }
      }];
  }
}

// CLI implementation that extends the base class
class GitHubAnalyticsCLI extends IntegrationCLI {
  constructor() {
    super('github-analytics', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'GitHub Analytics',
      key: 'github-analytics',
      description:
        'Track DORA metrics, delivery speed, stability, and code quality metrics for your GitHub repositories. Get insights on deployment frequency, lead time, PR throughput, change failure rate, and more.',
      icon: 'github',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://github.com/login/oauth/access_token',
          authorization_url: 'https://github.com/login/oauth/authorize',
          scopes: [
            'repo',
            'read:org',
          ],
          scope_separator: ',',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
function main() {
  const githubAnalyticsCLI = new GitHubAnalyticsCLI();
  githubAnalyticsCLI.parse();
}

main();
