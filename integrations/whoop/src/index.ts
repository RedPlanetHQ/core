import { fileURLToPath } from 'url';

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

class WhoopCLI extends IntegrationCLI {
  constructor() {
    super('whoop', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Whoop extension',
      key: 'whoop',
      description:
        'Connect your Whoop wearable to track recovery scores, sleep performance, strain, and workouts. Get insights into your health and fitness data.',
      icon: 'whoop',
      schedule: {
        frequency: '0 */6 * * *',
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.prod.whoop.com/oauth/oauth2/token',
          authorization_url: 'https://api.prod.whoop.com/oauth/oauth2/auth',
          scopes: [
            'read:profile',
            'read:recovery',
            'read:cycles',
            'read:sleep',
            'read:workout',
            'read:body_measurement',
            'offline',
          ],
          scope_separator: ' ',
          scope_identifier: 'scope',
          token_params: {
            grant_type: 'authorization_code',
          },
        },
      },
    };
  }
}

function main() {
  const whoopCLI = new WhoopCLI();
  whoopCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
