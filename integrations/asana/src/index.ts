import { fileURLToPath } from 'url';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';

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

      const config = eventPayload.config as Record<string, any>;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class AsanaCLI extends IntegrationCLI {
  constructor() {
    super('asana', '0.1.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Asana',
      key: 'asana',
      description:
        'Connect your Asana workspace to CORE. List workspaces, projects, and tasks, create tasks, and add comments — all from your workspace.',
      icon: 'asana',
      auth: {
        OAuth2: {
          authorization_url: 'https://app.asana.com/-/oauth_authorize',
          token_url: 'https://app.asana.com/-/oauth_token',
          default_scopes: ['default'],
          scope_separator: ' ',
        },
      },
      mcp: {
        type: 'cli',
      },
    };
  }
}

function main() {
  const asanaCLI = new AsanaCLI();
  asanaCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
