import { beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), put: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => client } }));
import { callTool } from '../index';

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: [{ id: 2, name: 'bug' }] });
  client.patch.mockResolvedValue({ data: { html_url: 'https://codeberg.org/team/work/issues/42' } });
  client.put.mockResolvedValue({ data: [] });
});
const update = (args: Record<string, unknown>) => callTool('update_issue', { owner: 'team', repo: 'work', issue_number: 42, ...args }, { access_token: 'test' });

describe('Codeberg issue label replacement', () => {
  it('sends labels to the dedicated replacement endpoint', async () => {
    await update({ title: 'Updated title', labels: [7, 'bug'] });
    expect(client.patch).toHaveBeenCalledExactlyOnceWith('/repos/team/work/issues/42', { title: 'Updated title' });
    expect(client.put).toHaveBeenCalledExactlyOnceWith('/repos/team/work/issues/42/labels', { labels: [7, 2] });
  });
  it('clears labels with an explicit empty array without editing other fields', async () => {
    await update({ labels: [] });
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
    expect(client.put).toHaveBeenCalledExactlyOnceWith('/repos/team/work/issues/42/labels', { labels: [] });
  });
  it('does not change labels when they are omitted', async () => {
    await update({ body: 'Updated body' });
    expect(client.put).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
    expect(client.patch).toHaveBeenCalledExactlyOnceWith('/repos/team/work/issues/42', { body: 'Updated body' });
  });
  it('resolves label names before any issue mutation', async () => {
    await expect(update({ title: 'Keep existing title', labels: ['missing'] })).rejects.toThrow('Label not found');
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
  });
  it('reports a failed replacement instead of claiming success', async () => {
    client.put.mockRejectedValue(new Error('Permission denied'));
    await expect(update({ labels: [2] })).rejects.toThrow('Permission denied');
  });
  it('encodes repository identifiers for label-only updates', async () => {
    const result = await update({ owner: 'te/am', repo: 'wo rk', labels: [2] });
    expect(client.put).toHaveBeenCalledExactlyOnceWith('/repos/te%2Fam/wo%20rk/issues/42/labels', { labels: [2] });
    expect(result.content[0].text).toContain('https://codeberg.org/te%2Fam/wo%20rk/issues/42');
  });
});
