import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { fileURLToPath } from 'url';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    default:
      return [
        {
          type: 'message',
          data: { message: `The event payload type is ${eventPayload.event}` },
        },
      ];
  }
}

class IntercomCLI extends IntegrationCLI {
  constructor() {
    super('intercom', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Intercom',
      key: 'intercom',
      description:
        'Connect your Intercom workspace to CORE. Sync conversations, contacts, and events — stay on top of customer support and engagement directly from your workspace.',
      icon: 'intercom',
      schedule: {
        frequency: '*/15 * * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.intercom.io/auth/eagle/token',
          authorization_url: 'https://app.intercom.com/oauth',
          scopes: ['read_users', 'read_conversations'],
          scope_separator: ' ',
        },
      },
    };
  }
}

function main() {
  const intercomCLI = new IntercomCLI();
  intercomCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
