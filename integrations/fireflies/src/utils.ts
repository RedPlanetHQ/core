import axios from 'axios';

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

export async function callFirefliesAPI(
  config: Record<string, any>,
  query: string,
  variables?: Record<string, any>
): Promise<any> {
  const response = await axios.post(
    FIREFLIES_GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data.errors) {
    const firstError = response.data.errors[0];
    throw new Error(firstError.message || 'GraphQL error');
  }

  return response.data.data;
}
