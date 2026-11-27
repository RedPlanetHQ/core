import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { handleSchedule } from '../schedule';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async importOriginal => {
  const { default: axios } = await importOriginal<typeof import('axios')>();
  return { default: { create: () => ({ get }), isAxiosError: axios.isAxiosError } };
});

const config = { api_key: 'test-key' };
const state = { lastSyncTime: '2026-01-01T10:00:00.000Z' };
const cutoff = '2026-01-01T11:00:00.000Z';

beforeEach(() => {
  get.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(cutoff));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const meeting = (id: number, created_at: string) => ({
  recording_id: id,
  created_at,
  title: 'Meeting ' + id,
  recorded_by: { name: 'Alice', email: 'alice@example.com' },
  default_summary: { markdown_formatted: 'Decisions from the call' },
  share_url: 'https://fathom.video/share/' + id,
});

const rateLimitError = {
  isAxiosError: true,
  response: { status: 429, headers: { 'retry-after': '2' } },
};

it('fetches all pages and retries a throttled page with its cursor', async () => {
  let lastPageAttempts = 0;
  get.mockImplementation(async (path: string, { params }: { params: { cursor?: string } }) => {
    expect(path).toBe('/meetings');
    const page = Number(params.cursor || '1');
    if (page < 6) {
      return { data: { items: [], next_cursor: String(page + 1) } };
    }
    if (++lastPageAttempts === 1) throw rateLimitError;
    return { data: { items: [meeting(123, state.lastSyncTime)], next_cursor: null } };
  });

  const pending = handleSchedule(config, state);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(lastPageAttempts).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  const result = await pending;

  expect(get).toHaveBeenCalledTimes(7);
  expect(get).toHaveBeenLastCalledWith('/meetings', {
    params: {
      created_after: '2026-01-01T09:59:59.999Z',
      created_before: cutoff,
      include_summary: true,
      cursor: '6',
    },
  });
  expect(result).toEqual([
    {
      type: 'activity',
      data: {
        text: expect.stringContaining('Recorded by: Alice\nDecisions from the call'),
        sourceURL: 'https://fathom.video/share/123',
        sourceActivityId: '123',
      },
    },
    { type: 'state', data: { lastSyncTime: cutoff } },
  ]);
});

it('emits meetings at the cutoff only in the next sync', async () => {
  const fixtures = [
    meeting(1, '2026-01-01T10:59:59.999999Z'),
    meeting(2, cutoff),
    meeting(3, '2026-01-01T11:00:00.000001Z'),
  ];
  get.mockResolvedValue({ data: { items: fixtures, next_cursor: null } });

  const first = await handleSchedule(config, state);
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  const second = await handleSchedule(config, { lastSyncTime: cutoff });

  expect(first).toEqual([
    expect.objectContaining({ data: expect.objectContaining({ sourceActivityId: '1' }) }),
    { type: 'state', data: { lastSyncTime: cutoff } },
  ]);
  expect(second).toEqual([
    expect.objectContaining({ data: expect.objectContaining({ sourceActivityId: '2' }) }),
    expect.objectContaining({ data: expect.objectContaining({ sourceActivityId: '3' }) }),
    { type: 'state', data: { lastSyncTime: '2026-01-01T12:00:00.000Z' } },
  ]);
});

it('leaves the checkpoint unchanged when a later page fails', async () => {
  get.mockResolvedValueOnce({
    data: { items: [meeting(123, state.lastSyncTime)], next_cursor: 'next' },
  });
  get.mockRejectedValueOnce(new Error('Temporary failure'));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(await handleSchedule(config, state)).toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it('leaves the checkpoint unchanged when a legacy summary stays throttled', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'legacy' }] });
  get.mockRejectedValue(rateLimitError);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const pending = handleSchedule(config, state);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toEqual([]);
  expect(get).toHaveBeenCalledTimes(3);
  expect(get).toHaveBeenLastCalledWith('/meetings/legacy/summary', { params: {} });
});
