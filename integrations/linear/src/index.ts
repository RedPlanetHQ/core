import { handleSchedule } from './schedule';
import { integrationCreate, integrationCreateForMCP } from './account-create';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return eventPayload.eventBody.mcp
        ? await integrationCreateForMCP(eventPayload.eventBody)
        : await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class LinearCLI extends IntegrationCLI {
  constructor() {
    super('linear', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Linear extension',
      key: 'linear',
      description:
        'Plan, track, and manage your agile and software development projects in Linear. Customize your workflow, collaborate, and release great software.',
      icon: 'linear',
      schedule: {
        frequency: '*/5 * * * *',
      },
      auth: {
        api_key: {
          type: 'string',
          label: 'Linear API Key',
        },
      },
      mcp: {
        type: 'http',
        url: 'https://mcp.linear.app/mcp',
        needsAuth: true,
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const linearCLI = new LinearCLI();
  linearCLI.parse();
}

main();
