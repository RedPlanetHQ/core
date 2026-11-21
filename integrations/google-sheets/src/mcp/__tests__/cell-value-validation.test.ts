import { beforeEach, expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { update } } }) },
}));

const args = { spreadsheetId: 'test-sheet', sheetName: 'Sheet1', cell: 'A1' };

beforeEach(() => update.mockReset().mockResolvedValue({ data: { updatedRange: 'Sheet1!A1' } }));

it.each([undefined, null, {}, [1]])(
  'rejects an invalid cell value %j before calling Sheets',
  async value => {
    const result = await callTool('write_to_cell', { ...args, value }, '', '', '', {});
    expect(update).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Error:');
  }
);

it.each(['', false, 0])('preserves the valid cell value %j', async value => {
  await callTool('write_to_cell', { ...args, value }, '', '', '', {});
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ requestBody: { values: [[value]] } })
  );
});

it('advertises the value as required', async () => {
  const schema = (await getTools()).find(tool => tool.name === 'write_to_cell')?.inputSchema;
  expect(schema).toMatchObject({ required: expect.arrayContaining(['value']) });
});
