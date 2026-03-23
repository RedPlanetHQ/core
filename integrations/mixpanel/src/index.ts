import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { fileURLToPath } from 'url';

import { integrationCreate } from './account-create';
import { getTools, callTool } from './mcp';
import { MixpanelConfig } from './utils';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS:
      return getTools();

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as unknown as MixpanelConfig;

      if (!config?.service_account_username || !config?.service_account_secret || !config?.project_id) {
        return {
          content: [{ type: 'text', text: 'Error: Mixpanel credentials not configured' }],
          isError: true,
        };
      }

      if (!config.region) config.region = 'US';

      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return [
        {
          type: 'message',
          data: { message: `The event payload type is ${eventPayload.event}` },
        },
      ];
  }
}

class MixpanelCLI extends IntegrationCLI {
  constructor() {
    super('mixpanel', '1.0.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Mixpanel',
      key: 'mixpanel',
      description:
        'Connect your Mixpanel project to CORE. Query analytics events, user profiles, funnels, retention, and annotations — all from your workspace.',
      icon: 'mixpanel',
      auth: {
        api_key: {
          fields: [
            {
              name: 'service_account_username',
              label: 'Service Account Username',
              placeholder: 'sa-xxxxx.project.mixpanel',
              description:
                'Your Mixpanel Service Account username. Create one in Project Settings → Service Accounts.',
            },
            {
              name: 'service_account_secret',
              label: 'Service Account Secret',
              placeholder: 'your-service-account-secret',
              description: 'The secret for your Mixpanel Service Account.',
            },
            {
              name: 'project_id',
              label: 'Project ID',
              placeholder: '12345678',
              description:
                'Your Mixpanel Project ID. Found in Project Settings → Project Details.',
            },
            {
              name: 'region',
              label: 'Data Residency',
              placeholder: 'US',
              description:
                'Set to "US" for US data residency (default) or "EU" for EU data residency.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const mixpanelCLI = new MixpanelCLI();
  mixpanelCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
