import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { fileURLToPath } from 'url';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

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
        'Connect your Mixpanel project to CORE. Sync analytics events, user profiles, funnel metrics, retention cohorts, and annotations — all from your workspace.',
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
      schedule: {
        frequency: '*/30 * * * *',
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
