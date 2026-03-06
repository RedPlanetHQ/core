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
        const tools = getTools();
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

      const config = eventPayload.config as Record<string, string>;
      const { name, arguments: args } = eventPayload.eventBody;

      return await callTool(name, args, config);
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class MetabaseCLI extends IntegrationCLI {
  constructor() {
    super('metabase', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Metabase',
      key: 'metabase',
      description:
        'Connect your Metabase instance to access dashboards, questions, database connections, and analytics activity. Execute queries and track data insights directly from your workspace.',
      icon: 'metabase',
      schedule: {
        frequency: '*/15 * * * *',
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'metabase_url',
              label: 'Metabase URL',
              placeholder: 'https://your-metabase.example.com',
              description: 'Your Metabase instance URL without a trailing slash.',
            },
            {
              name: 'api_key',
              label: 'API Key',
              placeholder: 'your-api-key',
              description:
                'Found in Metabase Admin → Settings → Authentication → API Keys. Create a key and assign it to a group for permission control.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const metabaseCLI = new MetabaseCLI();
  metabaseCLI.parse();
}

main();
