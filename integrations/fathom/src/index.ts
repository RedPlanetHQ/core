import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Message,
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
      return await handleSchedule(
        eventPayload.config as Record<string, string>,
        eventPayload.state as Record<string, string>,
      );

    case IntegrationEventType.GET_TOOLS: {
      try {
        const tools = await getTools();
        return tools;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        return { message: `Error ${message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as Record<string, string>;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class FathomCLI extends IntegrationCLI {
  constructor() {
    super('fathom', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<Message[]> {
    return (await run(eventPayload)) as Message[];
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Fathom',
      key: 'fathom',
      description:
        'Sync meeting recordings, transcripts, summaries, and action items from Fathom into CORE.',
      icon: 'fathom',
      auth: {
        api_key: {
          header_name: 'X-Api-Key',
          format: '{api_key}',
        },
      },
    };
  }
}

function main() {
  const fathomCLI = new FathomCLI();
  fathomCLI.parse();
}

main();
