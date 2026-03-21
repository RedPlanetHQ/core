export async function integrationCreate(data: any) {
  const { oauthResponse } = data;

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
  };

  const user = await fetchAsanaUser(integrationConfiguration.access_token);

  return [
    {
      type: 'account',
      data: {
        settings: {
          user: {
            id: user.gid,
            name: user.name,
            email: user.email,
          },
        },
        accountId: user.gid,
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: integrationConfiguration.access_token } },
        },
      },
    },
  ];
}

async function fetchAsanaUser(accessToken: string) {
  const response = await fetch('https://app.asana.com/api/1.0/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Asana user: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}
