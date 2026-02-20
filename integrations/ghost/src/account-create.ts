import axios from 'axios';

import { getAuthHeaders } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  // Fields are passed directly from the endpoint for multi-field auth
  const { ghost_url, admin_api_key } = data;

  const ghostUrl = ghost_url.replace(/\/$/, ''); // strip trailing slash

  const response = await axios.get(`${ghostUrl}/ghost/api/v5/admin/site/`, {
    headers: getAuthHeaders(admin_api_key),
  });

  const site = response.data.site;

  return [
    {
      type: 'account',
      data: {
        settings: {
          site_title: site.title,
          ghost_url: ghostUrl,
        },
        accountId: ghostUrl,
        config: {
          ghost_url: ghostUrl,
          admin_api_key,
        },
      },
    },
  ];
}
