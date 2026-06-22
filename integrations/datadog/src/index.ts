import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config as Record<string, unknown>, eventPayload.state);

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class DatadogCLI extends IntegrationCLI {
  constructor() {
    super('datadog', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Datadog',
      key: 'datadog',
      description:
        'Connect Datadog to CORE to surface monitor alerts and infrastructure events as activities.',
      icon: 'datadog',
      schedule: {
        frequency: '*/15 * * * *',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'API Key (DD-API-KEY)',
              placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              description:
                'Your Datadog API key. Found in Datadog → Organization Settings → API Keys.',
            },
            {
              name: 'app_key',
              label: 'Application Key (DD-APPLICATION-KEY)',
              placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              description:
                'Your Datadog Application key. Found in Datadog → Organization Settings → Application Keys.',
            },
            {
              name: 'region',
              label: 'Region',
              placeholder: 'US1',
              description:
                'Your Datadog region. One of: US1, US3, US5, EU, AP1. Defaults to US1.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const datadogCLI = new DatadogCLI();
  datadogCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
