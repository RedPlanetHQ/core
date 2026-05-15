import { getCurrentUser } from './utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function integrationCreate(data: any) {
  const { oauthResponse } = data;

  let userUri: string | null = null;
  let orgUri: string | null = null;
  let email: string | null = null;
  let name: string | null = null;

  try {
    const user = await getCurrentUser(oauthResponse.access_token);
    userUri = user.uri;
    orgUri = user.current_organization;
    email = user.email;
    name = user.name;
  } catch (error) {
    console.error('Error fetching Calendly user profile:', error);
  }

  return [
    {
      type: 'account',
      data: {
        settings: {
          userUri,
          orgUri,
          name,
        },
        accountId: email || userUri || 'calendly',
        config: {
          access_token: oauthResponse.access_token,
          refresh_token: oauthResponse.refresh_token,
          expires_in: oauthResponse.expires_in,
          expires_at: oauthResponse.expires_at,
          userUri,
          orgUri,
          email,
          name,
        },
      },
    },
  ];
}
