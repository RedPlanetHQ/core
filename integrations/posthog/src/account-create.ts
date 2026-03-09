import { getPostHogClient } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key, host } = data;

  const baseUrl = (host || 'https://app.posthog.com').replace(/\/$/, '');
  const client = getPostHogClient(api_key, baseUrl);

  // Validate the key and fetch current user info
  const userResponse = await client.get('/api/users/@me/');
  const user = userResponse.data;

  // Fetch the first available project
  const projectsResponse = await client.get('/api/projects/');
  const projects = projectsResponse.data.results || [];
  const firstProject = projects[0];

  const projectId = firstProject?.id?.toString() ?? '';
  const projectName = firstProject?.name ?? '';

  return [
    {
      type: 'account',
      data: {
        settings: {
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          project_name: projectName,
        },
        accountId: `posthog-${user.id ?? user.email}`,
        config: {
          api_key,
          host: baseUrl,
          project_id: projectId,
        },
      },
    },
  ];
}
