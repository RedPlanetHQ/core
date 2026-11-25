import { expect, it, vi } from 'vitest';

import { handleSchedule } from '../schedule';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

const config = { api_key: 'test-key' };
const state = { lastSyncTime: '2026-01-01T10:00:00.000Z' };

it('reads every meeting page and uses the recording summary and recorder name', async () => {
  get.mockReset();
  get.mockImplementation(async (path: string, { params }: { params: { cursor?: string } }) => {
    if (path === '/recordings/123/summary') {
      return { data: { summary: { markdown_formatted: 'Decisions from the call' } } };
    }

    expect(path).toBe('/meetings');
    const page = Number(params.cursor || '1');
    if (page < 6) {
      return { data: { items: [], next_cursor: String(page + 1) } };
    }
    return {
      data: {
        items: [
          {
            recording_id: 123,
            title: 'Planning',
            recorded_by: { name: 'Alice', email: 'alice@example.com' },
            url: 'https://fathom.video/calls/123',
          },
        ],
        next_cursor: null,
      },
    };
  });

  const result = await handleSchedule(config, state);

  expect(get).toHaveBeenCalledTimes(7);
  expect(get).toHaveBeenNthCalledWith(6, '/meetings', {
    params: { created_after: state.lastSyncTime, cursor: '6' },
  });
  expect(result).toEqual([
    {
      type: 'activity',
      data: {
        text: ['Meeting: Planning', 'Recorded by: Alice', 'Decisions from the call'].join('\n'),
        sourceURL: 'https://fathom.video/calls/123',
      },
    },
    { type: 'state', data: { lastSyncTime: expect.any(String) } },
  ]);
});

it('leaves the checkpoint unchanged when a later page fails', async () => {
  get.mockReset();
  get.mockResolvedValueOnce({
    data: { items: [{ recording_id: 123 }], next_cursor: 'next' },
  });
  get.mockRejectedValueOnce(new Error('Temporary failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    expect(await handleSchedule(config, state)).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});
