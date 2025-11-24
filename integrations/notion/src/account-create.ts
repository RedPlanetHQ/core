import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse } = data;

  // Fetch bot/workspace information using the access token
  let workspaceName = null;
  let workspaceId = null;
  let botId = null;

  try {
    // Notion returns bot info in the OAuth response
    // Additional user/workspace info can be fetched from /v1/users/me
    const userInfoResponse = await axios.get('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    const userData = userInfoResponse.data;
    botId = userData.id;
    workspaceName = userData.name || oauthResponse.workspace_name;
    workspaceId = oauthResponse.workspace_id || userData.id;
  } catch (error) {
    console.error('Error fetching Notion user info:', error);
    // Fallback to OAuth response data
    workspaceName = oauthResponse.workspace_name;
    workspaceId = oauthResponse.workspace_id;
    botId = oauthResponse.bot_id;
  }

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    token_type: oauthResponse.token_type,
    bot_id: botId,
    workspace_name: workspaceName,
    workspace_id: workspaceId,
    workspace_icon: oauthResponse.workspace_icon,
    owner: oauthResponse.owner,
  };

  return [
    {
      type: 'account',
      data: {
        settings: {
          workspace_name: workspaceName,
          bot_id: botId,
        },
        accountId: workspaceId || botId,
        config: integrationConfiguration,
      },
    },
  ];
}
