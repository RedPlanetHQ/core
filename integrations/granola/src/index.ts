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
      return await handleSchedule(eventPayload.config, eventPayload.state);

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

class GranolaCLI extends IntegrationCLI {
  constructor() {
    super('granola', '1.0.0');
  }

  protected async handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Granola',
      key: 'granola',
      description:
        'Sync AI meeting notes and transcripts from Granola into CORE. Access your meetings, summaries, and action items.',
      icon: 'granola',
      schedule: {
        frequency: '*/5 * * * *',
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://mcp-auth.granola.ai/oauth2/token',
          authorization_url: 'https://mcp-auth.granola.ai/oauth2/authorize',
          scopes: ['email', 'offline_access', 'openid', 'profile'],
          scope_separator: ' ',
          authorization_params: {
            code_challenge_method: 'S256',
          },
        },
      },
    };
  }
}

function main() {
  const granolaCLI = new GranolaCLI();
  granolaCLI.parse();
}

main();
