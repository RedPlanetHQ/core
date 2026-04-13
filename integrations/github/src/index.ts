import { handleSchedule } from './schedule';
import { integrationCreate } from './account-create';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { callTool, getTools } from './mcp';
import { fileURLToPath } from 'url';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      try {
        const config = eventPayload.config as Record<string, string>;
        const tools = await getTools(config);

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

// CLI implementation that extends the base class
class GitHubCLI extends IntegrationCLI {
  constructor() {
    super('github', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'GitHub extension',
      key: 'github',
      description:
        'Plan, track, and manage your agile and software development projects in GitHub. Customize your workflow, collaborate, and release great software.',
      icon: 'github',
      widgets: [
        {
          name: 'PR Files',
          slug: 'pr-files',
          description: 'Shows file changes for a GitHub Pull Request with a full diff view',
          support: ['webapp'],
          configSchema: [
            {
              key: 'owner',
              label: 'Owner',
              type: 'input',
              placeholder: 'e.g. RedPlanetHQ',
              required: true,
            },
            {
              key: 'repo',
              label: 'Repository',
              type: 'input',
              placeholder: 'e.g. core',
              required: true,
            },
            {
              key: 'pull_number',
              label: 'PR Number',
              type: 'input',
              placeholder: 'Leave empty for latest open PR',
              required: false,
            },
          ],
        },
      ],
      schedule: {
        frequency: '*/5 * * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://github.com/login/oauth/access_token',
          authorization_url: 'https://github.com/login/oauth/authorize',
          scopes: [
            'user',
            'public_repo',
            'repo',
            'notifications',
            'gist',
            'read:org',
            'repo_hooks',
            'project',
          ],
          scope_separator: ',',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const githubCLI = new GitHubCLI();
  githubCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
