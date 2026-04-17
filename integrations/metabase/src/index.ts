import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { callTool, getTools } from './mcp';
import { fileURLToPath } from 'url';

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
      widgets: [
        {
          name: 'Query Result',
          slug: 'metabase-query',
          description: 'Execute a saved Metabase question and display results as a table',
          support: ['webapp'],
          configSchema: [
            {
              key: 'question_id',
              label: 'Question ID',
              type: 'input',
              placeholder: 'e.g. 42',
              required: true,
            },
          ],
        },
        {
          name: 'Dashboard',
          slug: 'metabase-dashboard',
          description: 'Show questions from a Metabase dashboard with expandable results',
          support: ['webapp'],
          configSchema: [
            {
              key: 'dashboard_id',
              label: 'Dashboard ID',
              type: 'input',
              placeholder: 'e.g. 1',
              required: true,
            },
          ],
        },
      ],
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
