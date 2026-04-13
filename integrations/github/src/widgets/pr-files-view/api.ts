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

export type LineType = 'hunk' | 'add' | 'remove' | 'context';

export interface PatchLine {
  type: LineType;
  content: string;
}

export function parsePatch(patch: string): PatchLine[] {
  return patch
    .split('\n')
    .filter((l) => l !== '\\ No newline at end of file')
    .map((line) => {
      if (line.startsWith('@@')) return { type: 'hunk' as const, content: line };
      if (line.startsWith('+')) return { type: 'add' as const, content: line.slice(1) };
      if (line.startsWith('-')) return { type: 'remove' as const, content: line.slice(1) };
      return { type: 'context' as const, content: line.startsWith(' ') ? line.slice(1) : line };
    });
}
