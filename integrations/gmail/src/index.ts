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
      return eventPayload.eventBody.event.userEmail;

    case IntegrationEventType.PROCESS:
      return createActivityEvent(eventPayload.eventBody.eventData, eventPayload.config);

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
      description: 'Connect your workspace to Gmail. Monitor emails, send messages, and manage your email workflow',
      icon: 'gmail',
      mcp: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gmail'],
        env: {
          GOOGLE_CLIENT_ID: '${config:client_id}',
          GOOGLE_CLIENT_SECRET: '${config:client_secret}',
          GOOGLE_REFRESH_TOKEN: '${config:refresh_token}',
          GOOGLE_ACCESS_TOKEN: '${config:access_token}',
        },
      },
      auth: {
        OAuth2: {
          token_url: 'https://oauth2.googleapis.com/token',
          authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/gmail.labels',
            'https://www.googleapis.com/auth/gmail.metadata',
            'https://www.googleapis.com/auth/gmail.settings.basic',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          access_type: 'offline',
          prompt: 'consent',
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