import axios from 'axios';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  // Validate the API key by fetching workspace member info
  const response = await axios.get('https://api.attio.com/v2/workspace_members/me', {
    headers: {
      Authorization: `Bearer ${api_key}`,
      'Content-Type': 'application/json',
    },
  });

  const member = response.data?.data;
  const workspaceId = member?.id?.workspace_member_id || 'attio';
  const email = member?.email_address || '';
  const name =
    [member?.first_name, member?.last_name].filter(Boolean).join(' ') || 'Attio User';

  return [
    {
      type: 'account',
      data: {
        settings: {
          name,
          email,
        },
        accountId: `attio-${workspaceId}`,
        config: { api_key },
      },
    },
  ];
}
