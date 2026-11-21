import { beforeEach, expect, it, vi } from 'vitest';
import { callTool as docs } from '../index';
import { callTool as sheets } from '../../../../google-sheets/src/mcp/index';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => ({
  google: { docs: () => ({}), sheets: () => ({}), drive: () => ({ files: { list } }) },
}));

beforeEach(() => list.mockReset().mockResolvedValue({ data: { files: [] } }));

it.each([
  ['list_documents', docs, 'application/vnd.google-apps.document'],
  ['list_spreadsheets', sheets, 'application/vnd.google-apps.spreadsheet'],
] as const)(
  '%s filters out trashed files while continuing the current query',
  async (tool, callTool, mimeType) => {
    await callTool(tool, { pageToken: 'later' }, '', '', '', {});
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ q: `mimeType='${mimeType}' and trashed=false`, pageToken: 'later' })
    );
  }
);
