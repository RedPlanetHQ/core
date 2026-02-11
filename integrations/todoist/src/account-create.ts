import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch user information using the access token
  let userEmail = null;
  let userId = null;
  let userName = null;

  try {
    const userInfoResponse = await axios.get('https://api.todoist.com/api/v1/user', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
      },
    });

    const userData = userInfoResponse.data;
    userEmail = userData.email;
    userId = userData.id;
    userName = userData.full_name;
  } catch (error) {
    console.error('Error fetching user info:', error);
  }

  // For Todoist OAuth2, we need to store the tokens and user info
  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    token_type: oauthResponse.token_type || 'Bearer',
    scope: oauthResponse.scope,
    userEmail: userEmail,
    userId: userId,
    redirect_uri: oauthParams.redirect_uri || null,
  };

  const payload = {
    settings: {
      userName: userName,
      userEmail: userEmail,
    },
    accountId: integrationConfiguration.userEmail || integrationConfiguration.userId,
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
