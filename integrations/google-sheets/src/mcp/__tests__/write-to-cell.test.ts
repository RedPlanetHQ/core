import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { update } } }) },
}));

it.each([
  ['Sheet1', "'Sheet1'"],
  ['Monthly Budget', "'Monthly Budget'"],
  ["Team's Budget", "'Team''s Budget'"],
])('addresses the literal sheet title %s in A1 notation', async (sheetName, quotedTitle) => {
  update.mockReset().mockResolvedValue({ data: { updatedRange: `${quotedTitle}!B2` } });

  await callTool(
    'write_to_cell',
    { spreadsheetId: 'sheet', sheetName, cell: 'B2', value: 0, valueInputOption: 'RAW' },
    '',
    '',
    '',
    {}
  );

  expect(update).toHaveBeenCalledWith({
    spreadsheetId: 'sheet',
    range: `${quotedTitle}!B2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[0]] },
  });
});
