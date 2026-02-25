/**
 * Generate Bearer token headers for Atlassian Cloud API (OAuth 2.0).
 */
export function getAuthHeaders(
  accessToken: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
