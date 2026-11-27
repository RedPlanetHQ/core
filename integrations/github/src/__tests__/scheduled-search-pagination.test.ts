import { beforeEach, expect, it, vi } from 'vitest';

import { handleSchedule } from '../schedule';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({
  default: { get, isAxiosError: (error: { isAxiosError?: boolean }) => !!error.isAxiosError },
}));

const config = { access_token: 'test' };
const state = {
  username: 'user',
  lastSyncTime: '2026-01-01T10:00:00.000Z',
  lastUserEventTime: '2026-01-01T10:00:00.000Z',
};

function issue(index: number) {
  return {
    id: index,
    number: index,
    title: 'Issue ' + index,
    html_url: 'https://github.com/team/repo/issues/' + index,
    created_at: '2026-01-01T11:00:00Z',
  };
}

beforeEach(() => {
  get.mockReset();
});

it.each([
  { status: 429, headers: { 'retry-after': '2' } },
  { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767268801' } },
])('retries a rate-limited page ($status) without re-querying finished lanes', async (response) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  let lastPageCalls = 0;

  get.mockImplementation(async (url: string) => {
    if (url === 'https://api.github.com/user') return { data: { login: 'user' } };
    if (url.includes('/notifications?')) return { data: [] };
    if (!url.includes('q=author:user+type:issue')) {
      return { data: { total_count: 0, items: [] } };
    }
    if (new URL(url).searchParams.get('page') === '1') {
      return {
        data: { total_count: 101, items: Array.from({ length: 100 }, (_, i) => issue(i + 1)) },
      };
    }
    if (++lastPageCalls === 1) {
      throw { isAxiosError: true, response };
    }
    return { data: { total_count: 101, items: [issue(101)] } };
  });

  try {
    const sync = handleSchedule(config, state);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(lastPageCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await sync;

    expect(result.filter((message) => message.type === 'activity')).toHaveLength(101);
    expect(result).toContainEqual({
      type: 'activity',
      data: { text: expect.stringContaining('created issue #101'), sourceURL: issue(101).html_url },
    });
    expect(result).toContainEqual({
      type: 'state',
      data: expect.objectContaining({ lastUserEventTime: '2026-01-01T12:00:00.000Z' }),
    });
    const secondPageCalls = get.mock.calls.filter(
      ([url]) => url.includes('/search/issues?') && new URL(url).searchParams.get('page') === '2',
    );
    expect(secondPageCalls).toHaveLength(2);
    expect(secondPageCalls.every(([url]) => url.includes('q=author:user+type:issue'))).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps completed notifications and their checkpoint when search fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const subjectUrl = 'https://api.github.com/repos/team/repo/issues/10';
  get.mockImplementation(async (url: string) => {
    if (url === 'https://api.github.com/user') return { data: { login: 'user' } };
    if (url.includes('/notifications?')) {
      return {
        data: [
          {
            reason: 'assign',
            subject: { type: 'Issue', url: subjectUrl },
            repository: { full_name: 'team/repo' },
          },
        ],
      };
    }
    if (url === subjectUrl) return { data: issue(10) };
    throw {
      isAxiosError: true,
      response: { status: 403, headers: {}, data: { message: 'Forbidden' } },
    };
  });

  try {
    const result = await handleSchedule(config, state);
    expect(result).toEqual([
      {
        type: 'activity',
        data: {
          text: expect.stringContaining('Issue #10 assigned'),
          sourceURL: issue(10).html_url,
        },
      },
      {
        type: 'state',
        data: { ...state, lastSyncTime: expect.any(String) },
      },
    ]);
    expect(result[1]?.data).not.toEqual(state);
    expect(get.mock.calls.filter(([url]) => url.includes('/search/issues?'))).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});
