import { expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ calendarList: { list } }) } }));

it.each([
  ['empty page', []],
  ['populated page', [{ id: 'earlier', summary: 'Earlier calendar' }]],
])('returns a continuation token for a %s', async (_label, items) => {
  list
    .mockReset()
    .mockResolvedValueOnce({ data: { items, nextPageToken: 'next' } })
    .mockResolvedValueOnce({ data: { items: [{ id: 'later', summary: 'Later calendar' }] } });

  const first = await callTool('list_calendars', { showHidden: true }, '', '', '', {});
  expect(first.content[0].text).toContain('Next page token: next');
  expect(
    (await getTools()).find(tool => tool.name === 'list_calendars')?.inputSchema
  ).toMatchObject({
    properties: { pageToken: { type: 'string' } },
  });

  const second = await callTool(
    'list_calendars',
    { showHidden: true, pageToken: 'next' },
    '',
    '',
    '',
    {}
  );
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ showHidden: true, pageToken: 'next' })
  );
  expect(second.content[0].text).toContain('Later calendar');
  expect(second.content[0].text).not.toContain('Next page token');
});
