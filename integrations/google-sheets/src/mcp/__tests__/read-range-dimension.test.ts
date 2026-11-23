import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get } } }) },
}));

it.each([
  ['COLUMNS', undefined, 'Columns: 2'],
  [undefined, 'COLUMNS', 'Columns: 2'],
  ['ROWS', 'ROWS', 'Rows: 2'],
  [undefined, undefined, 'Rows: 2'],
])('reports the axis in a %s response for a %s request', async (returned, requested, label) => {
  get.mockResolvedValueOnce({
    data: {
      range: 'Sheet1!A1:B3',
      majorDimension: returned,
      values: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    },
  });
  const result = await callTool(
    'read_range',
    { spreadsheetId: 'sheet', range: 'Sheet1!A1:B3', majorDimension: requested },
    '',
    '',
    '',
    {}
  );
  expect(result.content[0].text).toContain(label);
});
