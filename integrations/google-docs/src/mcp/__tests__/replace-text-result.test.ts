import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { batchUpdate } = vi.hoisted(() => ({ batchUpdate: vi.fn() }));
vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { batchUpdate } }) } }));

it.each([
  [0, 'No matching text found'],
  [2, 'Replaced 2 occurrences'],
  [undefined, 'Google Docs did not return a replacement count'],
])('reports the provider replacement result for count %s', async (occurrencesChanged, expected) => {
  batchUpdate.mockResolvedValueOnce({
    data: { replies: [{ replaceAllText: { occurrencesChanged } }] },
  });
  const result = await callTool(
    'replace_text',
    { documentId: 'doc', searchText: 'old', replaceText: 'new' },
    '',
    '',
    '',
    {}
  );
  expect(result.content[0].text).toContain(expected);
});
