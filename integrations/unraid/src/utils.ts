import axios from 'axios';
import https from 'https';
import type { UnraidConfig } from './types';

/**
 * Execute a GraphQL query against the Unraid API
 */
export async function executeGraphQLQuery<T>(
  config: UnraidConfig,
  query: string,
  variables?: Record<string, any>,
): Promise<T> {
  const url = `${config.serverUrl}/graphql`;

  try {
    const response = await axios.post(
      url,
      {
        query,
        variables,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false, // Allow self-signed certificates
        }),
      },
    );

    if (response.data.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`);
    }

    return response.data.data as T;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Unraid API request failed: ${error.response?.status} ${error.response?.statusText}`,
      );
    }
    throw error;
  }
}

/**
 * Get default sync time (24 hours ago)
 */
export function getDefaultSyncTime(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString();
}

/**
 * Create an activity message
 */
export function createActivityMessage(text: string, sourceURL?: string) {
  return {
    type: 'activity' as const,
    data: {
      text,
      sourceURL,
    },
  };
}

/**
 * Get container name from names array (usually first element without leading slash)
 */
export function getContainerName(names: string[]): string {
  if (!names || names.length === 0) return 'Unknown';
  return names[0].replace(/^\//, '');
}
