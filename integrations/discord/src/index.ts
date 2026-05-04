import { integrationCreate } from './account-create';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { getTools, callTool } from './mcp';
import { fileURLToPath } from 'url';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();

      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as { bot_token?: string };
      const { name, arguments: args } = eventPayload.eventBody;

      if (!config?.bot_token) {
        return {
          content: [
            { type: 'text', text: 'Error: Discord bot token is missing from account config.' },
          ],
        };
      }

      const result = await callTool(name, args, config.bot_token);
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
        'Connect your Discord bot to send messages, manage channels, and react to events. Requires a bot token from the Discord Developer Portal.',
      icon: 'discord',
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'bot_token',
              label: 'Bot Token',
              placeholder: 'Bot token from Discord Developer Portal',
              description:
                'Discord Developer Portal → Your App → Bot → Reset Token. Enable Message Content Intent and Server Members Intent on the same screen.',
            },
          ],
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
