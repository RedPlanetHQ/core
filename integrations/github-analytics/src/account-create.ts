import { getGithubData } from "./utils";

export async function integrationCreate(data: any) {
  const { oauthResponse } = data;
  const integrationConfiguration = {
    refresh_token: oauthResponse.refresh_token,
    access_token: oauthResponse.access_token,
  };

  if (!integrationConfiguration.access_token) {
    throw new Error("No access token provided");
  }

  const user = await getGithubData(
    "https://api.github.com/user",
    integrationConfiguration.access_token
  );

  return [
    {
      type: "account",
      data: {
        settings: {
          login: user.login,
          username: user.login,
        },
        accountId: `github-analytics-${user.id.toString()}`,
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: integrationConfiguration.access_token } },
        },
      },
    },
  ];
}
