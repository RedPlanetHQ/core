import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get, batchUpdate } = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ data: { body: { content: [{ endIndex: 10 }] } } }),
  batchUpdate: vi.fn().mockResolvedValue({}),
}));

vi.mock('googleapis', () => ({ google: { docs: () => ({ documents: { get, batchUpdate } }) } }));

it('resolves the end of the document body when the write is applied', async () => {
  await callTool('append_text', { documentId: 'doc', text: 'New text' }, '', '', '', {});

  expect(batchUpdate).toHaveBeenCalledWith({
    documentId: 'doc',
    requestBody: {
      requests: [{ insertText: { endOfSegmentLocation: {}, text: 'New text' } }],
    },
  });
  expect(get).not.toHaveBeenCalled();
});
