import { getContacts, listServers } from './utils';

/**
 * Handles the setup event for the Systeme.io + Hetzner integration.
 * Validates both API keys and creates the integration account.
 *
 * Supports both:
 * - Multi-field API key flow: eventBody.apiKeys = { systeme_api_key, hetzner_api_token }
 * - Legacy OAuth flow: eventBody.oauthResponse = { systeme_api_key, hetzner_api_token }
 */
export async function integrationCreate(data: any) {
  // Support multi-field API key flow (apiKeys object) and legacy oauthResponse
  const keys = data.apiKeys || data.oauthResponse || {};

  const systemeApiKey = keys.systeme_api_key;
  const hetznerApiToken = keys.hetzner_api_token;

  if (!systemeApiKey || !hetznerApiToken) {
    return [
      {
        type: 'error',
        data: {
          message: 'Both Systeme.io API Key and Hetzner API Token are required.',
        },
      },
    ];
  }

  // Validate Systeme.io API Key
  let systemeValid = false;
  try {
    await getContacts(systemeApiKey, 1, 1);
    systemeValid = true;
  } catch (error: any) {
    const detail = error?.response?.status
      ? ` (HTTP ${error.response.status})`
      : error?.message
        ? ` (${error.message})`
        : '';
    return [
      {
        type: 'error',
        data: {
          message: `Invalid Systeme.io API Key${detail}. Please check your key in Settings → API Keys and try again.`,
        },
      },
    ];
  }

  // Validate Hetzner API Token
  let hetznerValid = false;
  try {
    await listServers(hetznerApiToken);
    hetznerValid = true;
  } catch (error: any) {
    const detail = error?.response?.status
      ? ` (HTTP ${error.response.status})`
      : error?.message
        ? ` (${error.message})`
        : '';
    return [
      {
        type: 'error',
        data: {
          message: `Invalid Hetzner API Token${detail}. Please check your token in Security → API Tokens and try again.`,
        },
      },
    ];
  }

  const integrationConfiguration = {
    systeme_api_key: systemeApiKey,
    hetzner_api_token: hetznerApiToken,
    access_token: systemeApiKey, // Required by SDK
  };

  return [
    {
      type: 'account',
      data: {
        settings: {
          systemeConnected: systemeValid,
          hetznerConnected: hetznerValid,
          plan: 'ki-power-99',
          monthlyPrice: 99,
          schedule: {
            frequency: '*/10 * * * *', // Sync every 10 minutes
          },
        },
        accountId: `systemeio-hetzner-${Date.now()}`,
        config: integrationConfiguration,
      },
    },
  ];
}
