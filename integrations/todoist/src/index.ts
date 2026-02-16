import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { getTools, callTool } from './mcp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function run(eventPayload: IntegrationEventPayload): Promise<any> {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      const config = eventPayload.config as Record<string, string>;
      const tools = await getTools(config);

      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);

      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class TodoistCLI extends IntegrationCLI {
  constructor() {
    super('todoist', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Todoist extension',
      key: 'todoist',
      description:
        'Connect your workspace to Todoist. Monitor tasks, create new tasks, and manage your productivity workflow',
      icon: 'todoist',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.todoist.com/oauth/access_token',
          authorization_url: 'https://api.todoist.com/oauth/authorize',
          scopes: ['data:read_write', 'data:delete', 'project:delete'],
          scope_identifier: 'scope',
          scope_separator: ',',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const todoistCLI = new TodoistCLI();
  todoistCLI.parse();
}

main();
