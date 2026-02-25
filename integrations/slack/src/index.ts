import { integrationCreate } from './account-create';
import { createActivityEvent } from './create-activity';
import { identify } from './identify';
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
      return await identify(eventPayload.integrationDefinition, eventPayload.eventBody);

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody.eventData, eventPayload.config);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();
      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config?.access_token);

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
            'reactions:read',
            'bookmarks:read',
            'channels:history',
            'channels:read',
            'channels:write',
            'chat:write',
            'groups:history',
            'groups:read',
            'groups:write',
            'im:history',
            'im:read',
            'im:write',
            'mpim:history',
            'mpim:read',
            'mpim:write',
            'reactions:read',
            'reactions:write',
            'search:read',
            'search:read.users',
            'stars:read',
            'team:read',
            'users:read',
          ],
          scope_identifier: 'user_scope',
          scope_separator: ',',
          authorization_params: {
            scope:
              'app_mentions:read,chat:write,im:history,im:read,im:write,users:read,channels:read',
          },
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
