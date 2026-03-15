import { getStripeAccount } from './utils';

export async function integrationCreate(data: {
  oauthResponse: {
    access_token: string;
    stripe_user_id?: string;
    scope?: string;
    token_type?: string;
    [key: string]: unknown;
  };
}) {
  const { oauthResponse } = data;
  const accessToken = oauthResponse.access_token;

  const account = await getStripeAccount(accessToken);

  const accountId = oauthResponse.stripe_user_id || account.id;
  const email = account.email as string | undefined;
  const displayName = (account.display_name || account.business_profile?.name || email || accountId) as string;

  return [
    {
      type: 'account',
      data: {
        settings: {
          accountId,
          email,
          displayName,
          livemode: account.livemode,
        },
        accountId,
        config: {
          access_token: accessToken,
          stripe_user_id: accountId,
          livemode: account.livemode,
        },
      },
    },
  ];
}
