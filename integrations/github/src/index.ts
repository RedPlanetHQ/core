import { handleSchedule } from './schedule';
import { integrationCreate } from './account-create';
import { handleWebhookIdentify } from './webhook-identify';
import { handleWebhookProcess } from './webhook-process';

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

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.IDENTIFY:
      return await handleWebhookIdentify(eventPayload.eventBody);

    case IntegrationEventType.PROCESS:
      return await handleWebhookProcess(eventPayload.eventBody, eventPayload.config);

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
          ],
          scope_separator: ' ',
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

main();
