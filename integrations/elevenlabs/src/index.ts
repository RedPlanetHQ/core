import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { fileURLToPath } from 'url';

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

class ElevenLabsCLI extends IntegrationCLI {
  constructor() {
    super('elevenlabs', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'ElevenLabs',
      key: 'elevenlabs',
      description:
        'Connect your ElevenLabs account to CORE. Track text-to-speech generation history, monitor your voice library, and log AI voice activity into your workspace timeline.',
      icon: 'elevenlabs',
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_key',
              label: 'API Key',
              placeholder: 'sk_...',
              description:
                'Find your API key in the ElevenLabs dashboard under Profile → API Key.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const elevenLabsCLI = new ElevenLabsCLI();
  elevenLabsCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
