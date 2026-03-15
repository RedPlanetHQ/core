import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { fileURLToPath } from 'url';

import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';
import { handleSchedule } from './schedule';
import { SentryConfig } from './utils';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      return getTools();
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as unknown as SentryConfig;

      if (!config?.auth_token) {
        return {
          content: [{ type: 'text', text: 'Error: No auth token provided in config' }],
          isError: true,
        };
      }

      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return [
        {
          type: 'message',
          data: { message: `The event payload type is ${eventPayload.event}` },
        },
      ];
  }
}

class SentryCLI extends IntegrationCLI {
  constructor() {
    super('sentry', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<unknown> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Sentry',
      key: 'sentry',
      description:
        'Connect your Sentry organization to CORE. Track errors and exceptions, manage issues, monitor releases, and get notified about new problems — all from your workspace.',
      icon: 'sentry',
      auth: {
        api_key: {
          fields: [
            {
              name: 'auth_token',
              label: 'Auth Token',
              placeholder: 'sntrys_xxxxxxxxxxxx',
              description:
                'Create an auth token in Sentry → Settings → Auth Tokens. Grant at minimum read access to Issues, Projects, and Organizations.',
            },
            {
              name: 'host',
              label: 'Sentry Host',
              placeholder: 'https://sentry.io',
              description:
                'Base URL of your Sentry instance. Use https://sentry.io for Sentry Cloud, or your self-hosted URL.',
            },
          ],
        },
      },
      schedule: {
        frequency: '*/30 * * * *',
      },
    };
  }
}

function main() {
  const sentryCLI = new SentryCLI();
  sentryCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
