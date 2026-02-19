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

class GhostCLI extends IntegrationCLI {
  constructor() {
    super('ghost', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Ghost Blog',
      key: 'ghost',
      description:
        'Connect your Ghost blog to manage posts, pages, tags, and members. Create and publish content directly from your workspace.',
      icon: 'ghost',
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'ghost_url',
              label: 'Ghost Blog URL',
              placeholder: 'https://myblog.ghost.io',
              description: 'Your Ghost blog URL without a trailing slash.',
            },
            {
              name: 'admin_api_key',
              label: 'Admin API Key',
              placeholder: 'your-key-id:your-secret',
              description:
                'Found in Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const ghostCLI = new GhostCLI();
  ghostCLI.parse();
}

main();
