import { beforeEach, expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

beforeEach(() => get.mockReset());

it('follows provider cursors and returns usable recording identifiers', async () => {
  get
    .mockResolvedValueOnce({
      data: { items: [{ title: 'First', recording_id: 123 }], next_cursor: 'next' },
    })
    .mockResolvedValueOnce({
      data: {
        items: [{ title: 'Second', recording_id: 456, recorded_by: { name: 'Alice' } }],
        next_cursor: null,
      },
    });

  const result = await callTool(
    'fathom_list_meetings',
    { limit: 2, recorded_by: 'alice@example.com' },
    { api_key: 'test' }
  );

  expect(result.content[0].text).toContain('ID: 123\nTitle: First');
  expect(result.content[0].text).toContain('ID: 456\nTitle: Second\nRecorded by: Alice');
  expect(get).toHaveBeenLastCalledWith('/meetings', {
    params: { 'recorded_by[]': 'alice@example.com', cursor: 'next' },
  });
});

it('honors the requested total result limit', async () => {
  get.mockResolvedValueOnce({
    data: {
      items: [
        { title: 'One', recording_id: 1 },
        { title: 'Two', recording_id: 2 },
      ],
      next_cursor: null,
    },
  });
  const result = await callTool('fathom_list_meetings', { limit: 1 }, { api_key: 'test' });
  expect(result.content[0].text).toContain('Found 1 meeting(s)');
  expect(result.content[0].text).not.toContain('Title: Two');
});
