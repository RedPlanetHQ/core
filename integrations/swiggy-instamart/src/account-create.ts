import { fetchSwiggyAccountId } from "./utils";

export async function integrationCreate(data: Record<string, any>) {
  const { oauthResponse } = data;
  const { access_token, refresh_token } = oauthResponse;

  const accountId = await fetchSwiggyAccountId(access_token);

  return [
    {
      type: "account",
      data: {
        accountId,
        config: {
          access_token,
          refresh_token,
          mcp: { tokens: { access_token } },
        },
        settings: {},
      },
    },
  ];
}
