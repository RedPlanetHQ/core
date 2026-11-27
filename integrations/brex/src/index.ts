import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventPayload.config as any,
        eventPayload.integrationDefinition,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventPayload.state as any,
      );

    case IntegrationEventType.GET_TOOLS: {
      try {
        return getTools();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { message: `Error ${message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = eventPayload.config as Record<string, any>;
      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class BrexCLI extends IntegrationCLI {
  constructor() {
    super('brex', '0.1.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Brex',
      key: 'brex',
      description:
        'Connect Brex read-only to surface card transactions, statements, and spend summaries in CORE.',
      icon: 'brex',
      mcp: {
        type: 'cli',
      },
      schedule: {
        frequency: '0 */4 * * *',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'Customer Token',
              placeholder: 'brex_user_token_...',
              description:
                'Your Brex customer token with read-only scopes (accounts.readonly, transactions.readonly). Create one in Brex Dashboard → Developer → Create Token.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const brexCLI = new BrexCLI();
  brexCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
