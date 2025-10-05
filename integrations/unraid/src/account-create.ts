import { executeGraphQLQuery } from './utils';
import type { SystemInfoResponse, UnraidConfig } from './types';

/**
 * Setup handler - validates Unraid connection and API key
 */
export async function integrationCreate(data: { serverUrl: string; apiKey: string }) {
  const config: UnraidConfig = {
    serverUrl: data.serverUrl.replace(/\/$/, ''), // Remove trailing slash
    apiKey: data.apiKey,
  };

  // Test query to validate connection and fetch server info
  const query = `
    query {
      info {
        id
        versions {
          core {
            unraid
            api
          }
        }
        system {
          model
        }
        baseboard {
          manufacturer
          model
        }
      }
      me {
        name
      }
    }
  `;

  try {
    const response = await executeGraphQLQuery<any>(config, query);

    if (!response.info) {
      throw new Error('Could not fetch Unraid server information');
    }

    const serverInfo = response.info;
    const version = serverInfo.versions?.core?.unraid || 'unknown';
    const accountId = `unraid-${serverInfo.id || Date.now()}`;

    return [
      {
        type: 'account',
        data: {
          settings: {
            serverUrl: config.serverUrl,
            version: version,
            model: serverInfo.system?.model,
            baseboard: serverInfo.baseboard?.model,
            username: response.me?.name,
          },
          accountId,
          config: {
            serverUrl: config.serverUrl,
            apiKey: config.apiKey,
          },
        },
      },
    ];
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to connect to Unraid server: ${error.message}`);
    }
    throw error;
  }
}
