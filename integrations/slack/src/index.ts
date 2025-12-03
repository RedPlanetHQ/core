import { integrationCreate } from './account-create';
import { createActivityEvent } from './create-activity';
import { getTools, callTool } from './mcp';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.IDENTIFY:
      return [
        {
          type: 'identifier',
          data:
            eventPayload.eventBody.event.event.user ||
            eventPayload.eventBody.event.event.message.user,
        },
      ];

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody.eventData, eventPayload.config);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();
      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(
        name,
        args,
        config?.access_token
      );

      return result;
    }

    default:
      return [{ type: 'error', data: `The event payload type is ${eventPayload.event}` }];
  }
}

// CLI implementation that extends the base class
class SlackCLI extends IntegrationCLI {
  constructor() {
    super('slack', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Slack extension',
      key: 'slack',
      description: 'Connect your workspace to Slack. Run your workflows from slack bookmarks',
      icon: 'slack',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://slack.com/api/oauth.v2.access',
          authorization_url: 'https://slack.com/oauth/v2/authorize',
          scopes: [
            'stars:read',
            'team:read',
            'stars:write',
            'users:read',
            'channels:read',
            'groups:read',
            'im:read',
            'im:history',
            'mpim:read',
            'mpim:write',
            'mpim:history',
            'channels:history',
            'chat:write',
            'reactions:read',
            'reactions:write',
            'users.profile:read',
            'files:read',
            'files:write',
            'reminders:read',
            'reminders:write',
            'search:read',
          ],
          scope_identifier: 'user_scope',
          scope_separator: ',',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const slackCLI = new SlackCLI();
  slackCLI.parse();
}

main();
