import { integrationCreate } from './account-create';
import { createActivityEvent } from './create-activity';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { mcp } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.IDENTIFY:
      return eventPayload.eventBody.event.userEmail;

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody.eventData, eventPayload.config);

    case IntegrationEventType.MCP:
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return 'No integration definition found';
      }

      const config = eventPayload.config as any;
      return mcp(
        integrationDefinition.config.client_id,
        integrationDefinition.config.client_secret,
        config?.callback,
        config?.token
      );

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class GmailCLI extends IntegrationCLI {
  constructor() {
    super('gmail', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Gmail extension',
      key: 'gmail',
      description:
        'Connect your workspace to Gmail. Monitor emails, send messages, and manage your email workflow',
      icon: 'gmail',
      // mcp: {
      //   env: { SLACK_MCP_XOXP_TOKEN: '${config:access_token}' },
      //   url: 'https://integrations.heysol.ai/slack/mcp/slack-mcp-server',
      //   args: [],
      //   type: 'stdio',
      // },
      auth: {
        OAuth2: {
          token_url: 'https://oauth2.googleapis.com/token',
          authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: [
            'https://mail.google.com',
            'https://www.googleapis.com/auth/gmail.labels',
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
  const gmailCLI = new GmailCLI();
  gmailCLI.parse();
}

main();
