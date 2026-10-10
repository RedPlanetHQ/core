import axios from 'axios';

import { getAuthHeaders } from './utils';

export async function integrationCreate(data: Record<string, any>) {
  const { oauthResponse } = data;
  const accessToken = oauthResponse.access_token;

  // Fetch current Trello member info
  const memberResponse = await axios.get(
    'https://api.trello.com/1/members/me',
    { headers: getAuthHeaders(accessToken) },
  );

  const member = memberResponse.data;

  return [
    {
      type: 'account',
      data: {
        settings: {
          display_name: member.fullName,
          email: member.email,
          username: member.username,
        },
        accountId: member.username,
        config: {
          access_token: oauthResponse.access_token,
          refresh_token: oauthResponse.refresh_token,
          token_type: oauthResponse.token_type,
          expires_in: oauthResponse.expires_in,
          scope: oauthResponse.scope,
          client_id: oauthResponse.client_id,
          client_secret: oauthResponse.client_secret,
          redirect_uri: data.oauthParams?.redirect_uri || null,
        },
      },
    },
  ];
}
