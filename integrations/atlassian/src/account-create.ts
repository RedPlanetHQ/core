import axios from 'axios';

import { getAuthHeaders } from './utils';

export async function integrationCreate(data: Record<string, any>) {
  const { oauthResponse } = data;
  const accessToken = oauthResponse.access_token;

  // Discover accessible Atlassian Cloud sites
  const resourcesResponse = await axios.get(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    { headers: getAuthHeaders(accessToken) },
  );

  const sites = resourcesResponse.data;
  if (!sites || sites.length === 0) {
    throw new Error('No accessible Atlassian Cloud sites found for this account.');
  }

  // Use the first accessible site
  const site = sites[0];
  const cloudId = site.id;
  const siteUrl = site.url;
  const siteName = site.name;

  // Fetch current user info
  const userResponse = await axios.get(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
    { headers: getAuthHeaders(accessToken) },
  );

  const user = userResponse.data;

  return [
    {
      type: 'account',
      data: {
        settings: {
          display_name: user.displayName,
          email: user.emailAddress,
          site_name: siteName,
          site_url: siteUrl,
        },
        accountId: user.accountId,
        config: {
          access_token: oauthResponse.access_token,
          refresh_token: oauthResponse.refresh_token,
          token_type: oauthResponse.token_type,
          expires_in: oauthResponse.expires_in,
          expires_at: oauthResponse.expires_at,
          scope: oauthResponse.scope,
          cloud_id: cloudId,
          site_url: siteUrl,
          client_id: oauthResponse.client_id,
          client_secret: oauthResponse.client_secret,
          redirect_uri: data.oauthParams?.redirect_uri || null,
        },
      },
    },
  ];
}
