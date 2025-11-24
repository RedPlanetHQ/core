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
class ZohoMailCLI extends IntegrationCLI {
  constructor() {
    super('zoho-mail', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Zoho Mail',
      key: 'zoho-mail',
      description:
        'Connect your workspace to Zoho Mail. Send, receive, and manage emails with powerful automation',
      icon: 'zoho-mail',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://accounts.zoho.com/oauth/v2/token',
          authorization_url: 'https://accounts.zoho.com/oauth/v2/auth',
          scopes: [
            'ZohoMail.messages.ALL',
            'ZohoMail.folders.ALL',
            'ZohoMail.accounts.READ',
          ],
          scope_identifier: 'scope',
          scope_separator: ',',
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
  const zohoMailCLI = new ZohoMailCLI();
  zohoMailCLI.parse();
}

main();
