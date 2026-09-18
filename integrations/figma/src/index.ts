import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { createActivityEvent } from './create-activity';
import { handleSchedule } from './schedule';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody.eventData, eventPayload.config);

    case IntegrationEventType.GET_TOOLS: {
      try {
        return getTools();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { message: `Error ${message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      return await callTool(name, args, config?.access_token);
    }

    default:
      return [{ type: 'error', data: `The event payload type is ${eventPayload.event}` }];
  }
}

// CLI implementation that extends the base class
class FigmaCLI extends IntegrationCLI {
  constructor() {
    super('figma', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Figma',
      key: 'figma',
      description:
        'Connect your Figma workspace to track file updates, comments, version history, and design activity in CORE.',
      icon: 'figma',
      schedule: {
        frequency: '*/15 * * * *',
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://www.figma.com/api/oauth/token',
          authorization_url: 'https://www.figma.com/oauth',
          scopes: [
            'file_content:read',
            'file_comments:read',
            'file_comments:write',
            'file_dev_resources:read',
            'webhooks:write',
          ],
          scope_separator: ',',
          fields: [
            {
              name: 'access_token',
              label: 'Access Token',
              placeholder: '',
              description: 'OAuth2 access token issued by Figma after authorization.',
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
  const figmaCLI = new FigmaCLI();
  figmaCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
