import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
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
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config?.bot_token);

      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class TelegramCLI extends IntegrationCLI {
  constructor() {
    super('telegram', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Telegram extension',
      key: 'telegram',
      description:
        'Connect your workspace to Telegram. Send messages, manage chats, track updates, and automate bot interactions',
      icon: 'telegram',
      mcp: {
        type: 'cli',
      },
      schedule: {
        frequency: '*/15 * * * *',
      },
      auth: {
        APIKey: {
          key: 'bot_token',
          label: 'Bot Token',
          description:
            'Your Telegram Bot token from @BotFather (format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)',
        },
      },
    };
  }
}

function main() {
  const telegramCLI = new TelegramCLI();
  telegramCLI.parse();
}

main();
