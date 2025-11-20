import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { mcp } from './mcp';
import { integrationCreate } from './account-create';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.MCP:
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return 'No integration definition found';
      }

      const config = eventPayload.config as any;
      return mcp(
        integrationDefinition.config.clientId,
        integrationDefinition.config.clientSecret,
        config?.redirect_uri,
        config
      );

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class GoogleDocCLI extends IntegrationCLI {
  constructor() {
    super('google-docs', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Google Docs extension',
      key: 'google-docs',
      description:
        'Connect your workspace to Google Docs. Create, read, edit, and format documents with powerful automation',
      icon: 'google-docs',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://oauth2.googleapis.com/token',
          authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: [
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive.file',
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
  const googleDocCLI = new GoogleDocCLI();
  googleDocCLI.parse();
}

main();
