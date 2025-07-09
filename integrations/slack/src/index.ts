// import { IntegrationPayloadEventType } from '@redplanethq/sol-sdk';

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
      return await integrationCreate(eventPayload.eventBody, eventPayload.integrationDefinition);

    case IntegrationEventType.IDENTIFY:
      return eventPayload.eventBody.event.user;

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody, eventPayload.config);

    default:
      return {
        message: `The event payload type is ${eventPayload.event}`,
      };
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
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: {
          SLACK_BOT_TOKEN: '${config:access_token}',
          SLACK_TEAM_ID: '${config:team_id}',
          SLACK_CHANNEL_IDS: '${config:channel_ids}',
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
