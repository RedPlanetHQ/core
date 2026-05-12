import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as utils from '../utils';
import { callTool, getTools } from '../mcp';

type Axios = { get: ReturnType<typeof vi.fn> };

function mockClient(responses: Array<{ path: RegExp; data: unknown }>): Axios {
  const get = vi.fn(async (path: string) => {
    const match = responses.find((r) => r.path.test(path));
    if (!match) throw new Error(`No mock for ${path}`);
    return { data: match.data };
  });
  return { get };
}

describe('getTools', () => {
  it('exposes the 5 read-only tools with JSON schemas', () => {
    const tools = getTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_statement',
        'get_top_merchants',
        'list_card_accounts',
        'list_statements',
        'list_transactions',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe('callTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T18:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns isError when api_key missing', async () => {
    const result = (await callTool('list_card_accounts', {}, {})) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No api_key');
  });

  it('list_card_accounts calls GET /v2/accounts/card and returns text payload', async () => {
    const client = mockClient([
      {
        path: /\/v2\/accounts\/card$/,
        data: { items: [{ id: 'ca_1', name: 'Primary', primary: true }] },
      },
    ]);
    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    const result = (await callTool('list_card_accounts', {}, { api_key: 'k' })) as Array<{
      text: string;
    }>;
    expect(result[0].text).toContain('ca_1');
    expect(result[0].text).toContain('Primary');
  });

  it('list_transactions forwards posted_at_start and cursor', async () => {
    const client = mockClient([
      {
        path: /\/v2\/transactions\/card\/primary$/,
        data: { items: [], next_cursor: null },
      },
    ]);
    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    await callTool(
      'list_transactions',
      { posted_at_start: '2026-04-01', limit: 25, cursor: 'abc' },
      { api_key: 'k' },
    );
    expect(client.get).toHaveBeenCalledWith('/v2/transactions/card/primary', {
      params: { limit: 25, posted_at_start: '2026-04-01', cursor: 'abc' },
    });
  });

  it('get_top_merchants aggregates and sorts by spend', async () => {
    const client = mockClient([
      {
        path: /\/v2\/transactions\/card\/primary$/,
        data: {
          next_cursor: null,
          items: [
            {
              id: '1',
              amount: { amount: 1000, currency: 'USD' },
              merchant: { raw_descriptor: 'AWS' },
            },
            {
              id: '2',
              amount: { amount: 2000, currency: 'USD' },
              merchant: { raw_descriptor: 'AWS' },
            },
            {
              id: '3',
              amount: { amount: 500, currency: 'USD' },
              merchant: { raw_descriptor: 'Slack' },
            },
          ],
        },
      },
    ]);
    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    const result = (await callTool('get_top_merchants', { top_n: 5 }, { api_key: 'k' })) as Array<{
      text: string;
    }>;

    const parsed = JSON.parse(result[0].text) as {
      top_merchants: Array<{ merchant: string; total: string; transaction_count: number }>;
    };
    expect(parsed.top_merchants[0].merchant).toBe('AWS');
    expect(parsed.top_merchants[0].total).toBe('$30.00 USD');
    expect(parsed.top_merchants[0].transaction_count).toBe(2);
    expect(parsed.top_merchants[1].merchant).toBe('Slack');
  });

  it('wraps API errors into isError response', async () => {
    const get = vi.fn(async () => {
      const err = new Error('request failed') as Error & {
        response?: { data?: { message?: string } };
      };
      err.response = { data: { message: 'Unauthorized' } };
      throw err;
    });
    vi.spyOn(utils, 'createBrexClient').mockReturnValue({ get } as never);

    const result = (await callTool('list_card_accounts', {}, { api_key: 'bad' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });

  it('returns unknown tool message for unrecognized name', async () => {
    vi.spyOn(utils, 'createBrexClient').mockReturnValue({ get: vi.fn() } as never);

    const result = (await callTool('does_not_exist', {}, { api_key: 'k' })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain('Unknown tool: does_not_exist');
  });
});
