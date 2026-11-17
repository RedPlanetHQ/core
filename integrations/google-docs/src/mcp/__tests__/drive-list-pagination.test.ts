import { beforeEach, expect, it, vi } from 'vitest';
import { callTool as docs, getTools as getDocsTools } from '../index';
import {
  callTool as sheets,
  getTools as getSheetsTools,
} from '../../../../google-sheets/src/mcp/index';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => ({
  google: { docs: () => ({}), sheets: () => ({}), drive: () => ({ files: { list } }) },
}));

beforeEach(() => list.mockReset());

it.each([
  ['list_documents', docs, getDocsTools],
  ['list_spreadsheets', sheets, getSheetsTools],
] as const)('%s lets the caller continue after an empty page', async (tool, callTool, getTools) => {
  const definition = (await getTools()).find(candidate => candidate.name === tool);
  expect(definition?.inputSchema).toMatchObject({
    properties: { pageToken: { type: 'string' } },
  });

  list
    .mockResolvedValueOnce({ data: { nextPageToken: 'next-page' } })
    .mockResolvedValueOnce({ data: { files: [{ id: 'file', name: 'Budget' }] } });

  const first = await callTool(tool, {}, '', '', '', {});
  expect(first.content[0].text).toContain('Next page token: next-page');
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ fields: expect.stringContaining('nextPageToken') })
  );

  const second = await callTool(tool, { pageToken: 'next-page' }, '', '', '', {});
  expect(second.content[0].text).toContain('Budget');
  expect(second.content[0].text).not.toContain('Next page token');
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'next-page' }));
});
