import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { getTools, callTool } from './mcp';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Message,
  Spec,
} from '@redplanethq/sdk';

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
      const config = eventPayload.config as Record<string, string>;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config?.api_key);

      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class AttioCLI extends IntegrationCLI {
  constructor() {
    super('attio', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<Message[]> {
    return await run(eventPayload) as Message[];
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Attio',
      key: 'attio',
      description:
        'Connect your workspace to Attio CRM. Manage contacts, companies, notes, tasks, and lists to streamline your customer relationship management.',
      icon: 'attio',
      schedule: {
        frequency: '*/15 * * * *',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'Attio API Key',
              placeholder: 'your-attio-access-token',
              description:
                'Your Attio access token. Generate one from Attio Settings → API Keys.',
            },
          ],
        },
      } as Record<string, unknown> as Spec['auth'],
      mcp: {
        type: 'cli',
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const attioCLI = new AttioCLI();
  attioCLI.parse();
}

main();
