import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { callTool, getTools } from './mcp';
import { integrationCreate } from './account-create';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

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
        config
      );

      return result;
    }

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
      key: 'zoho-mail',
      mcp: { type: 'cli' },
      auth: {
        OAuth2: {
          scopes: [
            'ZohoMail.tasks.ALL',
            'ZohoMail.notes.ALL',
            'ZohoMail.messages.ALL',
            'ZohoMail.folders.ALL',
            'ZohoMail.accounts.ALL',
          ],
          token_url: 'https://accounts.zoho.com/oauth/v2/token',
          token_params: { prompt: 'consent', access_type: 'offline' },
          scope_separator: ',',
          scope_identifier: 'scope',
          authorization_url: 'https://accounts.zoho.com/oauth/v2/auth',
          authorization_params: { prompt: 'consent', access_type: 'offline' },
        },
      },
      icon: 'zoho-mail',
      name: 'Zoho Mail',
      description:
        'Connect your workspace to Zoho Mail. Send, receive, and manage emails with powerful automation',
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
