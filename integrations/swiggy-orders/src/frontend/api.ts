export interface ConnectedAccount {
  id: string;
  integrationDefinition: { slug: string; name: string };
  isActive: boolean;
}

/**
 * GET /api/v1/integration_account → returns all integration accounts in the
 * user's workspace. We filter for the three Swiggy slugs.
 */
export async function fetchSwiggyAccounts(
  baseUrl: string,
  pat: string,
): Promise<Record<string, ConnectedAccount | undefined>> {
  const res = await fetch(`${baseUrl}/api/v1/integration_account`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) return {};
  const json = (await res.json()) as { accounts?: ConnectedAccount[] };
  const accounts = json?.accounts ?? [];

  const map: Record<string, ConnectedAccount | undefined> = {};
  for (const acc of accounts) {
    const slug = acc.integrationDefinition?.slug;
    if (
      acc.isActive &&
      (slug === "swiggy-food" || slug === "swiggy-instamart" || slug === "swiggy-dineout")
    ) {
      map[slug] = acc;
    }
  }
  return map;
}

/**
 * Invoke a tool on a specific connected integration account via CORE's
 * public action endpoint.
 */
export async function callAction(
  baseUrl: string,
  accountId: string,
  pat: string,
  action: string,
  parameters: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(
    `${baseUrl}/api/v1/integration_account/${accountId}/action`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify({ action, parameters }),
    },
  );
  if (!res.ok) return null;
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
