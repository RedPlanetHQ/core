import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS: {
      try {
        const tools = await getTools();
        return tools;
      } catch (e: any) {
        return { message: `Error ${e.message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class ConfluenceCLI extends IntegrationCLI {
  constructor() {
    super('confluence', '1.0.0');
  }

  protected async handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Confluence',
      key: 'confluence',
      description:
        'Connect your Confluence Cloud to search, create, and manage pages and spaces.',
      icon: 'confluence',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://auth.atlassian.com/oauth/token',
          authorization_url: 'https://auth.atlassian.com/authorize',
          scopes: [
            'read:confluence-content.all',
            'write:confluence-content',
            'read:confluence-space.summary',
            'search:confluence',
            'read:me',
            'offline_access',
          ],
          scope_separator: ' ',
          authorization_params: {
            audience: 'api.atlassian.com',
            prompt: 'consent',
          },
        },
      },
    };
  }
}

function main() {
  const confluenceCLI = new ConfluenceCLI();
  confluenceCLI.parse();
}

main();
