import { getContacts, listServers } from './utils';

/**
 * Handles the setup event for the Systeme.io + Hetzner integration.
 * Validates both API keys and creates the integration account.
 */
export async function integrationCreate(data: any) {
  const { oauthResponse } = data;

  // Both keys come from the setup form
  const systemeApiKey = oauthResponse.systeme_api_key;
  const hetznerApiToken = oauthResponse.hetzner_api_token;

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
  } catch {
    return [
      {
        type: 'error',
        data: { message: 'Invalid Systeme.io API Key. Please check and try again.' },
      },
    ];
  }

  // Validate Hetzner API Token
  let hetznerValid = false;
  try {
    await listServers(hetznerApiToken);
    hetznerValid = true;
  } catch {
    return [
      {
        type: 'error',
        data: { message: 'Invalid Hetzner API Token. Please check and try again.' },
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
