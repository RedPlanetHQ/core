import { expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { batchUpdate } = vi.hoisted(() => ({ batchUpdate: vi.fn().mockResolvedValue({}) }));
vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { batchUpdate } }) } }));

it.each([undefined, 't.example'])('scopes replacements when tabId is %s', async tabId => {
  await callTool(
    'replace_text',
    { documentId: 'doc', searchText: 'Old', replaceText: 'New', tabId },
    '',
    '',
    '',
    {}
  );

  const replace = batchUpdate.mock.lastCall?.[0].requestBody.requests[0].replaceAllText;
  expect(replace).toEqual({
    containsText: { text: 'Old', matchCase: false },
    replaceText: 'New',
    ...(tabId ? { tabsCriteria: { tabIds: [tabId] } } : {}),
  });
  expect((await getTools()).find(tool => tool.name === 'replace_text')?.inputSchema).toMatchObject({
    properties: { tabId: { type: 'string' } },
  });
});
