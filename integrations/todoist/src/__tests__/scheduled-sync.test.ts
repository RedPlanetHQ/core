import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleSchedule } from '../schedule';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

const config = { access_token: 'test' };
const state = { lastSyncTime: '2026-01-01T09:00:00.000Z' };
const startedAt = '2026-01-01T10:00:00.000Z';
const task = { id: 'new-task', content: 'New task', added_at: '2026-01-01T09:30:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(startedAt));
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('imports a v1 task from a later page and keeps its direct link', async () => {
  get
    .mockResolvedValueOnce({ data: { results: [], next_cursor: 'next' } })
    .mockResolvedValueOnce({ data: { results: [task], next_cursor: null } });

  const result = await handleSchedule(config, state);
  expect(get).toHaveBeenLastCalledWith('/tasks', { params: { cursor: 'next' } });
  expect(result).toEqual([
    {
      type: 'activity',
      data: {
        text: expect.stringContaining(task.content),
        sourceURL: 'https://app.todoist.com/app/task/new-task',
      },
    },
    { type: 'state', data: { lastSyncTime: startedAt } },
  ]);
});

it('uses the v1 added_at timestamp and supports legacy creation timestamps', async () => {
  get.mockResolvedValueOnce({
    data: {
      results: [
        task,
        { id: 'old', content: 'Old task', added_at: '2025-12-31T09:30:00.000Z' },
        {
          id: 'legacy',
          content: 'Legacy task',
          created_at: task.added_at,
          url: 'https://app.todoist.com/app/task/legacy',
        },
      ],
      next_cursor: null,
    },
  });
  const result = await handleSchedule(config, state);
  expect(result.map(message => message.type)).toEqual(['activity', 'activity', 'state']);
  expect(result[0].data).toMatchObject({ text: expect.stringContaining('New task') });
  expect(result[1].data).toMatchObject({ sourceURL: 'https://app.todoist.com/app/task/legacy' });
});

it('emits neither activities nor a checkpoint after a page request fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  get
    .mockResolvedValueOnce({ data: { results: [task], next_cursor: 'next' } })
    .mockRejectedValueOnce(new Error('Provider unavailable'));

  expect(await handleSchedule(config, state)).toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it('leaves tasks created during the scan for the next run', async () => {
  const during = { ...task, added_at: startedAt };
  get.mockImplementationOnce(async () => {
    vi.setSystemTime(new Date('2026-01-01T10:00:01.000Z'));
    return { data: { results: [during], next_cursor: null } };
  });

  const first = await handleSchedule(config, state);
  expect(first).toEqual([{ type: 'state', data: { lastSyncTime: startedAt } }]);

  get.mockResolvedValueOnce({ data: { results: [during], next_cursor: null } });
  const second = await handleSchedule(config, { lastSyncTime: startedAt });
  expect(second.map(message => message.type)).toEqual(['activity', 'state']);
});

it('emits a task only once when Todoist repeats it on another page', async () => {
  get
    .mockResolvedValueOnce({ data: { results: [task], next_cursor: 'next' } })
    .mockResolvedValueOnce({ data: { results: [task], next_cursor: null } });

  const result = await handleSchedule(config, state);
  expect(get).toHaveBeenCalledTimes(2);
  expect(result.map(message => message.type)).toEqual(['activity', 'state']);
});
