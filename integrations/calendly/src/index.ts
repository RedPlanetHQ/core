import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { createActivity } from './create-activity';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class CalendlyCLI extends IntegrationCLI {
  constructor() {
    super('calendly', '1.0.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Calendly',
      key: 'calendly',
      description:
        'Connect your Calendly account to view and manage event types, scheduled meetings, invitees, availability, routing forms, and webhook subscriptions in CORE.',
      icon: 'calendly',
      auth: {
        OAuth2: {
          authorization_url: 'https://auth.calendly.com/oauth/authorize',
          token_url: 'https://auth.calendly.com/oauth/token',
          scopes: ['default'],
          scope_separator: ' ',
          token_request_auth_method: 'basic',
        },
      },
    };
  }
}

function main() {
  const calendlyCLI = new CalendlyCLI();
  calendlyCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
