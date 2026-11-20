import { beforeEach, expect, it, vi } from 'vitest';
import { callTool, getTools } from '../index';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ events: { list } }) } }));

beforeEach(() => list.mockReset());

it('advertises and follows a continuation token after an empty page', async () => {
  list
    .mockResolvedValueOnce({ data: { nextPageToken: 'next-page', items: [] } })
    .mockResolvedValueOnce({ data: { items: [{ id: 'later', summary: 'Team check-in' }] } });

  const args = { calendarId: 'work', maxResults: 1, q: 'check-in' };
  const first = await callTool('list_events', args, '', '', '', {});
  expect(first.content[0].text).toContain('Next page token: next-page');
  expect((await getTools()).find(tool => tool.name === 'list_events')?.inputSchema).toMatchObject({
    properties: { pageToken: { type: 'string' } },
  });

  const second = await callTool('list_events', { ...args, pageToken: 'next-page' }, '', '', '', {});
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ ...args, pageToken: 'next-page' })
  );
  expect(second.content[0].text).toContain('Team check-in');
  expect(second.content[0].text).not.toContain('Next page token');
});

it('includes a continuation token alongside events on a populated page', async () => {
  list.mockResolvedValueOnce({
    data: { nextPageToken: 'more', items: [{ id: 'first', summary: 'First event' }] },
  });

  const result = await callTool('list_events', {}, '', '', '', {});
  expect(result.content[0].text).toContain('First event');
  expect(result.content[0].text).toContain('Next page token: more');
});
