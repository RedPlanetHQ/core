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

      const result = await callTool(
        name,
        args,
        integrationDefinition.config.clientId,
        integrationDefinition.config.clientSecret,
        config?.redirect_uri,
        config,
      );

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
      widgets: [
        {
          name: 'Now Playing',
          slug: 'now-playing',
          description: 'Shows the currently playing track from your Spotify account',
          support: ['tui', 'webapp'],
          tuiPlacement: 'below-input',
        },
      ],
      description:
        'Connect your Spotify account to access your music, control playback, view currently playing tracks, recently played history, saved library, and search the Spotify catalog.',
      icon: 'spotify',
      auth: {
        OAuth2: {
          token_url: 'https://accounts.spotify.com/api/token',
          authorization_url: 'https://accounts.spotify.com/authorize',
          scopes: [
            'user-read-playback-state',
            'user-read-currently-playing',
            'user-read-recently-played',
            'user-library-read',
            'playlist-read-private',
            'playlist-read-collaborative',
            'user-read-email',
            'user-read-private',
          ],
          scope_separator: ' ',
          token_request_auth_method: 'basic',
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
