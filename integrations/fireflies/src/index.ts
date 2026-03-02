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

class FirefliesCLI extends IntegrationCLI {
  constructor() {
    super('fireflies', '1.0.0');
  }

  protected async handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Fireflies',
      key: 'fireflies',
      description:
        'Connect Fireflies.ai to access meeting transcripts, summaries, and action items.',
      icon: 'fireflies',
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'API Key',
              placeholder: 'your-fireflies-api-key',
              description:
                'Found in Fireflies → Settings → Integrations → Fireflies API.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const firefliesCLI = new FirefliesCLI();
  firefliesCLI.parse();
}

main();
