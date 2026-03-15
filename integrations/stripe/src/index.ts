import { fileURLToPath } from 'url';

import { IntegrationCLI, IntegrationEventPayload, IntegrationEventType, Spec } from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config as Record<string, unknown>, eventPayload.state);

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class StripeCLI extends IntegrationCLI {
  constructor() {
    super('stripe', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<unknown> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Stripe',
      key: 'stripe',
      description:
        'Connect your Stripe account to track payments, subscriptions, customers, invoices, disputes, and payouts in CORE.',
      icon: 'stripe',
      schedule: {
        frequency: '0 */6 * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://connect.stripe.com/oauth/token',
          authorization_url: 'https://connect.stripe.com/oauth/authorize',
          scopes: ['read_only'],
          scope_separator: ' ',
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
