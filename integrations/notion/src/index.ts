import { integrationCreate } from './account-create';

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
        type: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: {
          Authorization: 'Bearer ${config:access_token}',
          'Content-Type': 'application/json',
        },
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.notion.com/v1/oauth/token',
          authorization_url: 'https://api.notion.com/v1/oauth/authorize',
          scopes: [],
          scope_separator: ' ',
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
