import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

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

class TrelloCLI extends IntegrationCLI {
  constructor() {
    super('trello', '1.0.0');
  }

  protected async handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Trello',
      key: 'trello',
      description:
        'Connect Trello to search, create, and manage boards, lists, and cards.',
      icon: 'trello',
      schedule: {
        frequency: '*/5 * * * *',
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://auth.atlassian.com/oauth/token',
          authorization_url: 'https://auth.atlassian.com/authorize',
          scopes: ['read:trello', 'write:trello', 'delete:trello', 'offline_access'],
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
  const trelloCLI = new TrelloCLI();
  trelloCLI.parse();
}

main();
