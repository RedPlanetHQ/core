import axios from 'axios';

export const identify = async (integrationDefinition: any, eventBody: any) => {
  try {
    const response = await axios.post(
      'https://slack.com/api/apps.event.authorizations.list',
      {
        event_context: eventBody.event.event_context,
      },
      {
        headers: {
          Authorization: `Bearer ${integrationDefinition.config.appToken}`,
        },
      },
    );

    return response.data.authorizations.map((auth: { user_id: string }) => {
      return {
        type: 'identifier',
        data: auth.user_id,
      };
    });
  } catch (e) {
    return [];
  }
};
