import { expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { batchUpdate } = vi.hoisted(() => ({ batchUpdate: vi.fn().mockResolvedValue({}) }));
vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { batchUpdate } }) } }));

it.each([
  ['insert_text', 'location', { index: 1 }],
  ['append_text', 'endOfSegmentLocation', {}],
] as const)('can target a tab when calling %s', async (tool, field, base) => {
  const args = { documentId: 'doc', text: 'New text' };
  const definition = (await getTools()).find(item => item.name === tool);
  await callTool(tool, { ...args, tabId: 't.second' }, '', '', '', {});
  expect(batchUpdate.mock.lastCall?.[0].requestBody.requests[0].insertText).toMatchObject({
    [field]: { ...base, tabId: 't.second' },
  });
  expect(definition?.inputSchema).toMatchObject({ properties: { tabId: { type: 'string' } } });

  await callTool(tool, args, '', '', '', {});
  expect(batchUpdate.mock.lastCall?.[0].requestBody.requests[0].insertText[field]).toEqual(base);
});
