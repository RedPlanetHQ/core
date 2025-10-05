import { handleSchedule } from './schedule';
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

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class UnraidCLI extends IntegrationCLI {
  constructor() {
    super('unraid', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Unraid extension',
      key: 'unraid',
      description:
        'Monitor and track your Unraid server activity including Docker containers, VMs, array status, and system metrics.',
      icon: 'server',
      auth: {
        api_key: {
          header_name: 'Authorization',
          format: '',
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const unraidCLI = new UnraidCLI();
  unraidCLI.parse();
}

main();
