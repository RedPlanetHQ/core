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
      try {
        const tools = await getTools();
        return tools;
      } catch (e: any) {
        return { message: `Error ${e.message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class JiraCLI extends IntegrationCLI {
  constructor() {
    super('jira', '1.0.0');
  }

  protected async handleEvent(
    eventPayload: IntegrationEventPayload,
  ): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Jira',
      key: 'jira',
      description:
        'Connect your Jira Cloud to search, create, and manage issues and projects.',
      icon: 'jira',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://auth.atlassian.com/oauth/token',
          authorization_url: 'https://auth.atlassian.com/authorize',
          scopes: [
            'read:jira-work',
            'write:jira-work',
            'read:jira-user',
            'read:me',
            'offline_access',
          ],
          scope_separator: ' ',
          authorization_params: {
            audience: 'api.atlassian.com',
            prompt: 'consent',
          },
        },
      },
    };
  }
}

function main() {
  const jiraCLI = new JiraCLI();
  jiraCLI.parse();
}

main();
