import { beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ patch: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => client } }));
import { callTool, getTools } from '../index';

beforeEach(() => {
  vi.clearAllMocks();
  client.patch.mockResolvedValue({ data: { id: 12 } });
  client.delete.mockResolvedValue({ data: undefined });
});

describe('Codeberg label tool discovery', () => {
  it('advertises each tool name only once', async () => {
    const names = (await getTools()).map(tool => tool.name);
    expect(names.length).toBe(new Set(names).size);
  });
  it.each(['update_label', 'delete_label'])('advertises %s with its routing fields', async name => {
    const tool = (await getTools()).find(tool => tool.name === name);
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toMatchObject({ type: 'object', required: ['owner', 'repo', 'label_id'] });
  });
  it('routes an advertised update to the existing handler', async () => {
    await callTool('update_label', { owner: 'team', repo: 'work', label_id: 12, name: 'urgent' }, { access_token: 'test' });
    expect(client.patch).toHaveBeenCalledExactlyOnceWith('/repos/team/work/labels/12', { name: 'urgent' });
  });
  it('routes an advertised deletion to the existing handler', async () => {
    await callTool('delete_label', { owner: 'team', repo: 'work', label_id: 12 }, { access_token: 'test' });
    expect(client.delete).toHaveBeenCalledExactlyOnceWith('/repos/team/work/labels/12');
  });
  it('rejects a missing label ID before calling the provider', async () => {
    await expect(callTool('delete_label', { owner: 'team', repo: 'work' }, { access_token: 'test' })).rejects.toThrow('label_id');
    expect(client.delete).not.toHaveBeenCalled();
  });
});
