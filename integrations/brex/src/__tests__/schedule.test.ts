import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as utils from '../utils';
import { handleSchedule } from '../schedule';

type Axios = { get: ReturnType<typeof vi.fn> };

function mockBrexClient(responses: Array<{ path: RegExp; data: unknown }>): Axios {
  const get = vi.fn(async (path: string) => {
    const match = responses.find((r) => r.path.test(path));
    if (!match) throw new Error(`No mock for ${path}`);
    return { data: match.data };
  });
  return { get };
}

describe('handleSchedule', () => {
  const config = {
    api_key: 'test-key',
    primaryCardAccountName: 'Brex Card',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T18:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns [] when no api_key', async () => {
    const result = await handleSchedule({}, undefined, undefined);
    expect(result).toEqual([]);
  });

  it('emits activities for new transactions and advances state', async () => {
    const client = mockBrexClient([
      {
        path: /\/v2\/transactions\/card\/primary$/,
        data: {
          next_cursor: null,
          items: [
            {
              id: 'tx_1',
              posted_at_date: '2026-04-21',
              amount: { amount: 1299, currency: 'USD' },
              merchant: { raw_descriptor: 'Vercel' },
            },
            {
              id: 'tx_2',
              posted_at_date: '2026-04-22',
              amount: { amount: 2500, currency: 'USD' },
              merchant: { raw_descriptor: 'OpenAI' },
            },
          ],
        },
      },
      {
        path: /\/v2\/accounts\/card\/primary\/statements$/,
        data: { items: [] },
      },
    ]);

    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    const messages = await handleSchedule(config, undefined, {});

    const activities = messages.filter((m) => m.type === 'activity');
    expect(activities).toHaveLength(2);
    expect((activities[0].data as { text: string }).text).toContain('Vercel');
    expect((activities[1].data as { text: string }).text).toContain('OpenAI');

    const state = messages.find((m) => m.type === 'state');
    expect(state).toBeDefined();
    const stateData = state!.data as {
      lastSyncTime: string;
      seenTransactionIds: string[];
    };
    expect(stateData.seenTransactionIds).toContain('tx_1');
    expect(stateData.seenTransactionIds).toContain('tx_2');
    expect(stateData.lastSyncTime).toBe('2026-04-22T18:00:00.000Z');
  });

  it('deduplicates transactions using seenTransactionIds from state', async () => {
    const client = mockBrexClient([
      {
        path: /\/v2\/transactions\/card\/primary$/,
        data: {
          next_cursor: null,
          items: [
            {
              id: 'tx_1',
              posted_at_date: '2026-04-21',
              amount: { amount: 1299, currency: 'USD' },
              merchant: { raw_descriptor: 'Vercel' },
            },
            {
              id: 'tx_new',
              posted_at_date: '2026-04-22',
              amount: { amount: 2500, currency: 'USD' },
              merchant: { raw_descriptor: 'OpenAI' },
            },
          ],
        },
      },
      {
        path: /\/v2\/accounts\/card\/primary\/statements$/,
        data: { items: [] },
      },
    ]);

    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    const messages = await handleSchedule(config, undefined, {
      lastSyncTime: '2026-04-20T00:00:00Z',
      seenTransactionIds: ['tx_1'],
    });

    const activities = messages.filter((m) => m.type === 'activity');
    expect(activities).toHaveLength(1);
    expect((activities[0].data as { text: string }).text).toContain('OpenAI');
  });

  it('emits statement activities and dedupes via seenStatementIds', async () => {
    const client = mockBrexClient([
      {
        path: /\/v2\/transactions\/card\/primary$/,
        data: { next_cursor: null, items: [] },
      },
      {
        path: /\/v2\/accounts\/card\/primary\/statements$/,
        data: {
          items: [
            {
              id: 'st_already_seen',
              start_date: '2026-02-26',
              end_date: '2026-03-25',
              primary_statement_amount: { amount: 100000, currency: 'USD' },
            },
            {
              id: 'st_new',
              start_date: '2026-03-26',
              end_date: '2026-04-25',
              primary_statement_amount: { amount: 252302, currency: 'USD' },
              due_date: '2026-04-28',
            },
          ],
        },
      },
    ]);

    vi.spyOn(utils, 'createBrexClient').mockReturnValue(client as never);

    const messages = await handleSchedule(config, undefined, {
      seenStatementIds: ['st_already_seen'],
    });

    const activities = messages.filter((m) => m.type === 'activity');
    expect(activities).toHaveLength(1);
    const text = (activities[0].data as { text: string }).text;
    expect(text).toContain('$2523.02 USD');
    expect(text).toContain('2026-04-28');

    const state = messages.find((m) => m.type === 'state')!.data as {
      seenStatementIds: string[];
    };
    expect(state.seenStatementIds).toEqual(expect.arrayContaining(['st_already_seen', 'st_new']));
  });

  it('continues to emit state even when transaction fetch throws', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes('/transactions/')) {
        throw new Error('brex 500');
      }
      return { data: { items: [] } };
    });
    vi.spyOn(utils, 'createBrexClient').mockReturnValue({ get } as never);

    const messages = await handleSchedule(config, undefined, {});

    // No activities, but state still emitted
    expect(messages.filter((m) => m.type === 'activity')).toHaveLength(0);
    expect(messages.find((m) => m.type === 'state')).toBeDefined();
  });

  it('follows cursor pagination up to the 10-page safety cap', async () => {
    let callCount = 0;
    const get = vi.fn(async (path: string) => {
      if (path.includes('/transactions/')) {
        callCount += 1;
        return {
          data: {
            next_cursor: `cursor_${callCount}`,
            items: [
              {
                id: `tx_page_${callCount}`,
                posted_at_date: '2026-04-21',
                amount: { amount: 100, currency: 'USD' },
                merchant: { raw_descriptor: `Merchant ${callCount}` },
              },
            ],
          },
        };
      }
      return { data: { items: [] } };
    });
    vi.spyOn(utils, 'createBrexClient').mockReturnValue({ get } as never);

    const messages = await handleSchedule(config, undefined, {});

    // 10 pages max
    expect(callCount).toBe(10);
    expect(messages.filter((m) => m.type === 'activity')).toHaveLength(10);
  });
});
