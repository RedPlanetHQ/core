import axios from 'axios';

import { getAuthHeaders } from './utils';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  // When multi-field auth is used, apiKey is JSON-stringified { ghost_url, admin_api_key }
  const { ghost_url, admin_api_key } = JSON.parse(data.apiKey);

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
