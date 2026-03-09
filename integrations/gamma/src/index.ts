import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { getTools, callTool } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();
      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config?.api_key);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class GammaCLI extends IntegrationCLI {
  constructor() {
    super('gamma', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Gamma',
      key: 'gamma',
      description:
        'Sync your AI-generated presentations, documents, and websites from Gamma into CORE. Track content activity and manage your Gamma workspace directly from your workspace.',
      icon: 'gamma',
      schedule: {
        frequency: '*/30 * * * *',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'API Key',
              placeholder: 'sk-gamma-xxxxxxxx',
              description:
                'Found in Gamma → Settings → API key tab (Pro account required).',
            },
          ],
        },
      },
      mcp: {
        type: 'cli',
      },
    };
  }
}

function main() {
  const gammaCLI = new GammaCLI();
  gammaCLI.parse();
}

main();
