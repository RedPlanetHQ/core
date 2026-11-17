import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleSchedule } from '../schedule';

const { listTaskLists, listTasks } = vi.hoisted(() => ({
  listTaskLists: vi.fn(),
  listTasks: vi.fn(),
}));
vi.mock('googleapis', () => ({
  google: { tasks: () => ({ tasklists: { list: listTaskLists }, tasks: { list: listTasks } }) },
}));

const config = { access_token: 'test' };
const state = { lastSyncTime: '2026-01-01T09:00:00.000Z' };
const startedAt = '2026-01-01T10:00:00.000Z';
const duringSync = '2026-01-01T10:00:01.000Z';
const existingTask = { title: 'Existing task', updated: '2026-01-01T09:30:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(startedAt));
  listTaskLists
    .mockReset()
    .mockResolvedValue({ data: { items: [{ id: 'first', title: 'Tasks' }] } });
  listTasks.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('leaves a failed paginated scan eligible for retry without emitting partial activities', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  listTaskLists.mockResolvedValue({
    data: {
      items: [
        { id: 'first', title: 'Tasks' },
        { id: 'second', title: 'Work' },
      ],
    },
  });
  listTasks
    .mockResolvedValueOnce({ data: { items: [existingTask] } })
    .mockResolvedValueOnce({ data: { nextPageToken: 'next' } })
    .mockRejectedValueOnce(new Error('Request failed'));

  expect(await handleSchedule(config, state)).toEqual([]);
  expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'next' }));

  listTasks.mockResolvedValue({ data: { items: [] } }).mockResolvedValueOnce({
    data: { items: [existingTask] },
  });
  const retry = await handleSchedule(config, state);
  expect(listTasks).toHaveBeenLastCalledWith(
    expect.objectContaining({ updatedMin: state.lastSyncTime })
  );
  expect(retry.map(message => message.type)).toEqual(['activity', 'state']);
});

it.each([startedAt, duringSync])(
  'emits an update at %s on the next run using the scan start as the checkpoint',
  async updated => {
    const concurrentTask = { title: 'Concurrent task', updated };
    listTasks.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-01-01T10:00:02.000Z'));
      return { data: { items: [existingTask, concurrentTask] } };
    });

    const first = await handleSchedule(config, state);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      type: 'activity',
      data: { text: expect.stringContaining(existingTask.title) },
    });
    expect(first[1]).toMatchObject({ type: 'state', data: { lastSyncTime: startedAt } });

    listTasks.mockResolvedValueOnce({ data: { items: [concurrentTask] } });
    const second = await handleSchedule(config, { lastSyncTime: startedAt });
    expect(second[0]).toMatchObject({
      type: 'activity',
      data: { text: expect.stringContaining(concurrentTask.title) },
    });
    expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ updatedMin: startedAt }));
  }
);

it('picks up a deferred task after completion hides it in a Google client', async () => {
  const activeTask = { title: 'Deferred task', updated: duringSync, status: 'needsAction' };
  listTasks.mockResolvedValueOnce({ data: { items: [activeTask] } });

  const first = await handleSchedule(config, state);
  expect(first).toEqual([{ type: 'state', data: { lastSyncTime: startedAt } }]);

  const completedAt = '2026-01-01T10:01:00.000Z';
  const completedTask = {
    ...activeTask,
    updated: completedAt,
    completed: completedAt,
    hidden: true,
    status: 'completed',
  };
  listTasks.mockImplementationOnce(async ({ showCompleted, showHidden }) => ({
    data: { items: showCompleted && showHidden ? [completedTask] : [] },
  }));
  vi.setSystemTime(new Date('2026-01-01T10:15:00.000Z'));

  const second = await handleSchedule(config, { lastSyncTime: startedAt });
  expect(second.map(message => message.type)).toEqual(['activity', 'state']);
  expect(second[0].data).toMatchObject({ text: expect.stringContaining(activeTask.title) });
  expect(second[0].data).toMatchObject({ text: expect.stringContaining('**Status:** Completed') });
});
