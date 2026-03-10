import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';
import { fileURLToPath } from 'url';

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

class ResendCLI extends IntegrationCLI {
  constructor() {
    super('resend', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Resend',
      key: 'resend',
      description:
        'Connect your Resend account to send emails, manage audiences, contacts, domains, templates, and more.',
      icon: 'resend',
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'API Key',
              placeholder: 're_xxxxxxxxxxxxxxxxxxxx',
              description:
                'Your Resend API key. Found in Resend Dashboard → API Keys → Create API Key.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const resendCLI = new ResendCLI();
  resendCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
