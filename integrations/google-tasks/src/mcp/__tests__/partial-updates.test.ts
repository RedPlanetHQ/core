import { beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ patch: vi.fn(), update: vi.fn() }));
vi.mock('googleapis', () => ({ google: { tasks: () => ({ tasks: client }) } }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials() {}
    refreshAccessToken() {
      return Promise.resolve({ credentials: {} });
    }
  },
}));
import { callTool } from '../index';

const initial = {
  id: 'task-1',
  title: 'Buy groceries',
  notes: 'Milk and bread',
  due: '2026-11-16T00:00:00Z',
  status: 'needsAction',
};
let stored: typeof initial;
beforeEach(() => {
  vi.clearAllMocks();
  stored = structuredClone(initial);
  client.patch.mockImplementation(async ({ requestBody }) => ({
    data: Object.assign(stored, requestBody),
  }));
  client.update.mockImplementation(async () => {
    throw new Error('Partial updates must not use the replacement endpoint');
  });
});
const update = (args: Record<string, unknown>) =>
  callTool(
    'update_task',
    { taskListId: 'list-1', taskId: 'task-1', ...args },
    'test-client',
    'test-secret',
    'http://localhost/callback',
    { access_token: 'test' }
  );

describe('Google Tasks partial updates', () => {
  it('marks a task complete without replacing its title, notes or due date', async () => {
    const result = await update({ status: 'completed' });
    expect(client.patch).toHaveBeenCalledExactlyOnceWith({
      tasklist: 'list-1',
      task: 'task-1',
      requestBody: { status: 'completed' },
    });
    expect(stored).toEqual({ ...initial, status: 'completed' });
    expect(result.content[0].text).toContain('Buy groceries');
    expect(client.update).not.toHaveBeenCalled();
  });
  it('renames a task without including unrelated fields in the patch', async () => {
    await update({ title: 'Get groceries' });
    expect(client.patch.mock.calls[0][0].requestBody).toEqual({ title: 'Get groceries' });
    expect(stored).toEqual({ ...initial, title: 'Get groceries' });
  });
  it('retains explicit empty notes so they can be cleared', async () => {
    await update({ notes: '' });
    expect(client.patch.mock.calls[0][0].requestBody).toEqual({ notes: '' });
    expect(stored).toEqual({ ...initial, notes: '' });
  });
  it('sends all supplied changes in one patch', async () => {
    await update({ title: 'Updated', notes: 'New notes', due: '2026-12-01T00:00:00Z' });
    expect(client.patch).toHaveBeenCalledTimes(1);
    expect(stored).toEqual({
      ...initial,
      title: 'Updated',
      notes: 'New notes',
      due: '2026-12-01T00:00:00Z',
    });
  });
  it('reports provider errors instead of reporting a successful update', async () => {
    client.patch.mockRejectedValue(new Error('Permission denied'));
    const result = await update({ status: 'completed' });
    expect(result.content[0].text).toContain('Error: Permission denied');
    expect(stored).toEqual(initial);
  });
});
