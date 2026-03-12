import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { callTool, getTools } from './mcp';
import { fileURLToPath } from 'url';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS: {
      try {
        const tools = await getTools();
        return tools;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { message: `Error ${message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class SpotifyCLI extends IntegrationCLI {
  constructor() {
    super('spotify', '1.0.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Spotify',
      key: 'spotify',
      description:
        'Connect your Spotify Developer app to search tracks, artists, albums, and playlists from the Spotify catalog.',
      icon: 'spotify',
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          fields: [
            {
              name: 'client_id',
              label: 'Client ID',
              placeholder: 'e.g. 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
              description:
                'Your Spotify app Client ID. Found in the Spotify Developer Dashboard → Your App → Settings.',
            },
            {
              name: 'client_secret',
              label: 'Client Secret',
              placeholder: 'e.g. a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
              description:
                'Your Spotify app Client Secret. Found in the Spotify Developer Dashboard → Your App → Settings.',
            },
          ],
        },
      },
    };
  }
}

function main() {
  const spotifyCLI = new SpotifyCLI();
  spotifyCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
