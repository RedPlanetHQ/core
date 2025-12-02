export async function integrationCreate(eventBody: any) {
  const messages = [];

  // Extract OAuth tokens from the event body
  const accessToken = eventBody.access_token;

  if (!accessToken) {
    throw new Error('No access token provided');
  }

  // Return configuration message
  messages.push({
    type: 'config',
    data: {
      access_token: accessToken,
    },
  });

  return messages;
}
