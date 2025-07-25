import { integrationCreate } from './account-create';
import { createActivityEvent } from './create-activity';
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
        command: 'slack-mcp-server',
        args: [],
        env: {
          SLACK_MCP_XOXP_TOKEN: '${config:access_token}',
        },
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
