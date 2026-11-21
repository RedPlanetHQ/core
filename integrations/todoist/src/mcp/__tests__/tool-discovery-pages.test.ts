import { beforeEach, expect, it, vi } from 'vitest';
import { getTools } from '../index';

const client = vi.hoisted(() => ({ connect: vi.fn(), listTools: vi.fn(), close: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = client.connect;
    listTools = client.listTools;
    close = client.close;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}));

beforeEach(() => {
  vi.resetAllMocks();
});

it.each(['next', ''])('discovers tools after a first page with cursor %j', async nextCursor => {
  const tool = { name: 'find-tasks', inputSchema: { type: 'object' } };
  client.listTools
    .mockResolvedValueOnce({ tools: [], nextCursor })
    .mockResolvedValueOnce({ tools: [tool] });

  expect(await getTools({ access_token: 'test' })).toEqual([expect.objectContaining(tool)]);
  expect(client.listTools).toHaveBeenLastCalledWith({ cursor: nextCursor });
  expect(client.close).toHaveBeenCalledOnce();
});

it('discards partial discovery on a repeated cursor and closes the client', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    client.listTools
      .mockResolvedValueOnce({ tools: [{ name: 'first' }], nextCursor: 'repeat' })
      .mockResolvedValueOnce({ tools: [{ name: 'second' }], nextCursor: 'repeat' })
      .mockResolvedValueOnce({ tools: [] });

    expect(await getTools({ access_token: 'test' })).toEqual([]);
    expect(client.listTools).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
