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
class GoogleTasksCLI extends IntegrationCLI {
  constructor() {
    super('google-tasks', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Google Tasks extension',
      key: 'google-tasks',
      description:
        'Connect your workspace to Google Tasks. Create, update, and manage your tasks and task lists',
      icon: 'google-tasks',
      mcp: {
        type: 'cli',
      },
      schedule: {
        frequency: '*/30 * * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://oauth2.googleapis.com/token',
          authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: [
            'https://www.googleapis.com/auth/tasks',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          token_params: {
            access_type: 'offline',
            prompt: 'consent',
          },
          authorization_params: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const googleTasksCLI = new GoogleTasksCLI();
  googleTasksCLI.parse();
}

main();
