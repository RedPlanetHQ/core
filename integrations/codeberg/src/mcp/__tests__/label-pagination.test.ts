import { beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => client } }));
import { callTool } from '../index';
const config = { access_token: 'test' };
const base = { owner: 'team', repo: 'work', issue_number: 42 };

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockReset().mockResolvedValue({ data: [] });
  client.post.mockResolvedValue({
    data: { number: 42, html_url: 'https://codeberg.org/team/work/issues/42' },
  });
  client.patch.mockResolvedValue({
    data: { html_url: 'https://codeberg.org/team/work/issues/42' },
  });
  client.put.mockResolvedValue({ data: [] });
});
function paginatedLabels() {
  client.get.mockImplementation(async (_path, options) => ({
    data:
      options?.params?.page === 2
        ? [{ id: 21, name: 'later' }]
        : options?.params?.page === 1
          ? [{ id: 1, name: 'first' }]
          : [],
  }));
}

describe('Codeberg label name pagination', () => {
  it('finds labels beyond a server-capped first page when creating issues', async () => {
    paginatedLabels();
    await callTool('create_issue', { ...base, title: 'New issue', labels: ['later'] }, config);
    expect(client.post.mock.calls[0][1].labels).toEqual([21]);
    expect(client.get.mock.calls.map(call => call[1].params.page)).toEqual([1, 2]);
  });
  it('resolves names across pages before replacing issue labels', async () => {
    paginatedLabels();
    await callTool('update_issue', { ...base, labels: [7, 'later', 'first'] }, config);
    expect(client.put).toHaveBeenCalledWith('/repos/team/work/issues/42/labels', {
      labels: [7, 21, 1],
    });
  });
  it('stops immediately once every requested name is resolved', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, name: 'first' }] });
    await callTool('create_issue', { ...base, title: 'New issue', labels: ['first'] }, config);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
  it('does not look up numeric label IDs', async () => {
    await callTool('create_issue', { ...base, title: 'New issue', labels: [7] }, config);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post.mock.calls[0][1].labels).toEqual([7]);
  });
  it('reports a missing name only after exhausting all pages, without writes', async () => {
    paginatedLabels();
    await expect(
      callTool('update_issue', { ...base, title: 'Keep title', labels: ['missing'] }, config)
    ).rejects.toThrow('Label not found: missing');
    expect(client.get.mock.calls.map(call => call[1].params.page)).toEqual([1, 2, 3]);
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
  });
  it('propagates a later-page failure without mutating the issue', async () => {
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'first' }] })
      .mockRejectedValueOnce(new Error('Rate limited'));
    await expect(
      callTool('create_issue', { ...base, title: 'New issue', labels: ['later'] }, config)
    ).rejects.toThrow('Rate limited');
    expect(client.post).not.toHaveBeenCalled();
  });
});
