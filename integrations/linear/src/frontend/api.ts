export async function callAction(
  baseUrl: string,
  accountId: string,
  pat: string,
  action: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/v1/integration_account/${accountId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pat}` },
    body: JSON.stringify({ action, parameters }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
