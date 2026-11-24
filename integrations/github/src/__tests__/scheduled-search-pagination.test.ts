import { expect, it, vi } from 'vitest';
import { handleSchedule } from '../schedule';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get } }));

it('continues when one raw search page is full after other lanes are empty', async () => {
  const state = {
    username: 'user',
    lastSyncTime: '2026-01-01T10:00:00Z',
    lastUserEventTime: '2026-01-01T10:00:00Z',
  };
  const issue = (index: number) => ({
    id: index,
    number: index,
    title: `Issue ${index}`,
    html_url: `https://github.com/team/repo/issues/${index}`,
    created_at: '2026-01-01T11:00:00Z',
  });

  get.mockImplementation(async (url: string) => {
    if (url === 'https://api.github.com/user') return { data: { login: 'user' } };
    if (url.includes('/notifications?')) return { data: [] };
    if (url.includes('q=author:user+type:issue')) {
      const page = new URL(url).searchParams.get('page');
      return {
        data: {
          total_count: 11,
          items: page === '1' ? Array.from({ length: 10 }, (_, i) => issue(i + 1)) : [issue(11)],
        },
      };
    }
    return { data: { total_count: 0, items: [] } };
  });

  const result = await handleSchedule({ access_token: 'test' }, state);
  expect(result.filter(message => message.type === 'activity')).toHaveLength(11);
  expect(result).toContainEqual({
    type: 'activity',
    data: { text: expect.stringContaining('created issue #11'), sourceURL: issue(11).html_url },
  });
});

it('does not advance the checkpoint when a search request fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  get.mockImplementation(async (url: string) => {
    if (url === 'https://api.github.com/user') return { data: { login: 'user' } };
    if (url.includes('/notifications?')) return { data: [] };
    throw new Error('Search unavailable');
  });
  try {
    expect(
      await handleSchedule(
        { access_token: 'test' },
        {
          username: 'user',
          lastSyncTime: '2026-01-01T10:00:00Z',
          lastUserEventTime: '2026-01-01T10:00:00Z',
        }
      )
    ).toEqual([]);
  } finally {
    log.mockRestore();
  }
});
