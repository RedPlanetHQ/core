import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
  Message,
} from '@redplanethq/sdk';
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

      const result = await callTool(
        name,
        args,
        integrationDefinition.config.clientId,
        integrationDefinition.config.clientSecret,
        config?.redirect_uri,
        config
      );

      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class DiscordCLI extends IntegrationCLI {
  constructor() {
    super('discord', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Discord extension',
      key: 'discord',
      description:
        'Connect your workspace to Discord. Send messages, manage channels, track server activity, and engage with your community',
      icon: 'discord',
      mcp: {
        type: 'cli',
      },
      schedule: {
        frequency: '*/15 * * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://discord.com/api/oauth2/token',
          authorization_url: 'https://discord.com/api/oauth2/authorize',
          scopes: [
            'identify',
            'guilds',
            'guilds.members.read',
            'bot',
            'messages.read',
            'gdm.join',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          token_params: {
            grant_type: 'authorization_code',
          },
          authorization_params: {
            permissions: '8', // Administrator permissions for bot
          },
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const discordCLI = new DiscordCLI();
  discordCLI.parse();
}

main();
