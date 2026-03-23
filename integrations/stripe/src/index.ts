import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { createActivity } from './create-activity';
import { identify } from './identify';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.IDENTIFY:
      return await identify(eventPayload.eventBody);

    case IntegrationEventType.PROCESS: {
      const event = eventPayload.eventBody?.eventData;
      if (!event) return [];
      const activity = createActivity(event);
      return activity ? [activity] : [];
    }

    case IntegrationEventType.GET_TOOLS: {
      try {
        return getTools();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { message: `Error ${message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as Record<string, unknown>;
      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class StripeCLI extends IntegrationCLI {
  constructor() {
    super('stripe', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Stripe',
      key: 'stripe',
      description:
        'Connect your Stripe account to track payments, subscriptions, customers, invoices, disputes, and payouts in CORE.',
      icon: 'stripe',
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'Stripe API Key',
              placeholder: 'sk_live_... or rk_live_...',
              description:
                'Your Stripe secret key or a restricted key with read access. Found in Stripe Dashboard → Developers → API keys.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const stripeCLI = new StripeCLI();
  stripeCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
