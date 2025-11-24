import { integrationCreate } from './account-create';
import { mcp } from './mcp';

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

    case IntegrationEventType.MCP:
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return 'No integration definition found';
      }

      const config = eventPayload.config as any;
      return mcp(config);

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class NotionCLI extends IntegrationCLI {
  constructor() {
    super('notion', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Notion',
      key: 'notion',
      description:
        'Connect your workspace to Notion. Create, read, and manage pages, databases, and blocks with powerful automation',
      icon: 'notion',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.notion.com/v1/oauth/token',
          authorization_url: 'https://api.notion.com/v1/oauth/authorize',
          scopes: [],
          scope_separator: ' ',
          authorization_params: {
            owner: 'user',
          },
          token_request_auth_method: 'basic',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const notionCLI = new NotionCLI();
  notionCLI.parse();
}

main();
