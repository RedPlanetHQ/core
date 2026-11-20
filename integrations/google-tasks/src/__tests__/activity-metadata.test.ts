import { expect, it, vi } from 'vitest';
import { handleSchedule } from '../schedule';

const { listTasks } = vi.hoisted(() => ({ listTasks: vi.fn() }));
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasklists: { list: async () => ({ data: { items: [{ id: 'tasks', title: 'Tasks' }] } }) },
      tasks: { list: listTasks },
    }),
  },
}));

const due = '2026-01-15T00:00:00.000Z';

async function syncTask() {
  listTasks.mockResolvedValue({
    data: {
      items: [
        {
          title: 'Existing task',
          updated: '2026-01-01T10:00:00.000Z',
          completed: '2026-01-01T10:00:00.000Z',
          status: 'completed',
          due,
        },
      ],
    },
  });
  const result = await handleSchedule(
    { access_token: 'test' },
    { lastSyncTime: '2026-01-01T09:00:00.000Z' }
  );
  expect(result[0]).toMatchObject({ type: 'activity' });
  return result[0].data.text;
}

it('keeps the provider due date in a timezone west of UTC', async () => {
  expect(await syncTask()).toContain('**Due:** 2026-01-15');
});

it('does not describe a completed task as newly created', async () => {
  const text = await syncTask();
  expect(text).toContain('Task changed');
  expect(text).toContain('**Status:** Completed');
});
