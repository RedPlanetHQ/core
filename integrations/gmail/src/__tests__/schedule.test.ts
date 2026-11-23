import { beforeEach, describe, expect, it, vi } from 'vitest';

const gmail = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('../utils', () => ({
  getGmailClient: async () => ({ users: { messages: gmail } }),
  parseEmailContent: () => ({
    textContent: 'An email with enough content for the activity feed.',
    htmlContent: '',
  }),
  formatEmailSender: (from: string) => from,
}));
import { handleSchedule } from '../schedule';

const firstTime = Date.parse('2026-01-01T12:00:00.000Z');
const definition = { config: { clientId: 'test-client', clientSecret: 'test-secret' } };
const initialState = { emailAddress: 'user@example.com', lastSyncTime: '2026-01-01T11:00:00.000Z' };
let inbox: Array<{ id: string; time: number }>;
let sent: Array<{ id: string; time: number }>;

function checkpoint(messages: any[]) {
  return messages.find(message => message.type === 'state')?.data;
}
function activities(messages: any[]) {
  return messages.filter(message => message.type === 'activity');
}

beforeEach(() => {
  vi.clearAllMocks();
  inbox = [];
  sent = [];
  gmail.list.mockImplementation(async ({ q }: { q: string }) => {
    const after = Number(q.match(/after:(\d+)/)![1]) * 1000;
    const source = q.startsWith('in:sent') ? sent : inbox;
    return {
      data: {
        messages: source.filter(message => message.time > after).map(({ id }) => ({ id })),
      },
    };
  });
  gmail.get.mockImplementation(async ({ id }: { id: string }) => {
    const message = [...inbox, ...sent].find(message => message.id === id)!;
    return {
      data: {
        internalDate: String(message.time),
        threadId: `thread-${id}`,
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'user@example.com' },
            { name: 'Subject', value: id },
            { name: 'Date', value: new Date(message.time).toUTCString() },
          ],
        },
      },
    };
  });
});

describe('Gmail schedule checkpoints', () => {
  it('does not move the checkpoint beyond the newest observed message', async () => {
    inbox.push({ id: 'inbox-1', time: firstTime });
    sent.push({ id: 'sent-1', time: firstTime + 5000 });
    const messages = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
    expect(activities(messages)).toHaveLength(2);
    expect(checkpoint(messages)).toMatchObject({
      lastSyncTime: new Date(firstTime + 5000).toISOString(),
      lastUserEventTime: new Date(firstTime + 5000).toISOString(),
      emailAddress: initialState.emailAddress,
    });
  });

  it.each([
    ['inbox', 5000],
    ['sent', 5000],
    ['inbox', 500],
    ['sent', 500],
  ] as const)('syncs a new %s message arriving %s milliseconds later', async (folder, delay) => {
    const source = folder === 'inbox' ? inbox : sent;
    source.push({ id: 'first', time: firstTime });
    const first = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
    source.push({ id: 'second', time: firstTime + delay });
    const second = await handleSchedule(
      { access_token: 'test-token' },
      definition,
      checkpoint(first)
    );
    expect(activities(second)).toHaveLength(1);
    expect(activities(second)[0].data.sourceURL).toContain('/second');
    // A third run must not duplicate either observed message.
    const third = await handleSchedule(
      { access_token: 'test-token' },
      definition,
      checkpoint(second)
    );
    expect(activities(third)).toHaveLength(0);
  });

  it('does not emit a new checkpoint when no messages were observed', async () => {
    const messages = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
    expect(messages).toEqual([]);
  });
});

it.each(['inbox', 'sent'] as const)('visits later pages in the %s query', async folder => {
  const source = folder === 'inbox' ? inbox : sent;
  source.push({ id: 'newer', time: firstTime + 1000 }, { id: 'older', time: firstTime });
  const list = vi.mocked(gmail.list);
  list.mockImplementation(async ({ q, pageToken }) => {
    if (!q.startsWith(`in:${folder}`)) return { data: { messages: [] } };
    return pageToken
      ? { data: { messages: [{ id: 'newer' }, { id: 'older' }] } }
      : { data: { messages: [{ id: 'newer' }], nextPageToken: 'older-page' } };
  });

  const messages = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
  expect(activities(messages).map(message => message.data.sourceURL)).toEqual([
    expect.stringContaining('/newer'),
    expect.stringContaining('/older'),
  ]);
  expect(gmail.get.mock.calls.filter(([request]) => request.id === 'newer')).toHaveLength(1);
  expect(checkpoint(messages)?.lastSyncTime).toBe(new Date(firstTime + 1000).toISOString());
  expect(gmail.list).toHaveBeenCalledWith(
    expect.objectContaining({ q: expect.stringContaining(`in:${folder}`), pageToken: 'older-page' })
  );
});

it('emits no activities or checkpoint when a later list page fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  inbox.push({ id: 'inbox-1', time: firstTime });
  gmail.list
    .mockResolvedValueOnce({ data: { messages: [{ id: 'inbox-1' }] } })
    .mockResolvedValueOnce({ data: { messages: [], nextPageToken: 'next-sent-page' } })
    .mockRejectedValueOnce(new Error('Service unavailable'));

  try {
    expect(await handleSchedule({ access_token: 'test-token' }, definition, initialState)).toEqual(
      []
    );
    expect(gmail.list).toHaveBeenCalledTimes(3);
  } finally {
    log.mockRestore();
  }
});

it('does not let the sent search skip an inbox arrival after the first search', async () => {
  const syncStart = firstTime + 500;
  const now = vi.spyOn(Date, 'now').mockReturnValue(syncStart);
  inbox.push({ id: 'before-start', time: firstTime });
  let searchedInbox = false;
  gmail.list.mockImplementation(async ({ q }: { q: string }) => {
    const isInbox = q.startsWith('in:inbox');
    const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
    const before = Number(q.match(/before:(\d+)/)?.[1] ?? Infinity) * 1000;
    const source = isInbox ? inbox : sent;
    const messages = source
      .filter(message => message.time > after && message.time < before)
      .map(({ id }) => ({ id }));

    if (isInbox && !searchedInbox) {
      searchedInbox = true;
      inbox.push({ id: 'late-inbox', time: syncStart + 50 });
      sent.push({ id: 'late-sent', time: syncStart + 100 });
      now.mockReturnValue(syncStart + 150);
    }
    return { data: { messages } };
  });

  try {
    const first = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
    expect(activities(first).map(message => message.data.sourceURL)).toEqual([
      expect.stringContaining('/before-start'),
    ]);
    expect(checkpoint(first)?.lastSyncTime).toBe(new Date(firstTime).toISOString());
    for (const [request] of gmail.list.mock.calls) {
      expect(request.q).toContain(`before:${Math.ceil(syncStart / 1000)}`);
    }

    now.mockReturnValue(syncStart + 2000);
    const second = await handleSchedule(
      { access_token: 'test-token' },
      definition,
      checkpoint(first)
    );
    expect(activities(second).map(message => message.data.sourceURL)).toEqual([
      expect.stringContaining('/late-inbox'),
      expect.stringContaining('/late-sent'),
    ]);
  } finally {
    now.mockRestore();
  }
});

it.each(['inbox', 'sent'] as const)(
  'retries the complete scan after a failed %s message read',
  async folder => {
    const source = folder === 'inbox' ? inbox : sent;
    source.push({ id: 'older', time: firstTime }, { id: 'newer', time: firstTime + 1000 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    gmail.get.mockRejectedValueOnce(
      Object.assign(new Error('Service unavailable'), { status: 503 })
    );

    try {
      expect(
        await handleSchedule({ access_token: 'test-token' }, definition, initialState)
      ).toEqual([]);
      const retried = await handleSchedule(
        { access_token: 'test-token' },
        definition,
        initialState
      );
      expect(activities(retried).map(message => message.data.sourceURL)).toEqual([
        expect.stringContaining('/older'),
        expect.stringContaining('/newer'),
      ]);
      expect(checkpoint(retried)?.lastSyncTime).toBe(new Date(firstTime + 1000).toISOString());
    } finally {
      log.mockRestore();
    }
  }
);

it('continues when a listed message has been deleted before its details are fetched', async () => {
  inbox.push({ id: 'deleted', time: firstTime }, { id: 'remaining', time: firstTime + 1000 });
  gmail.get.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));

  const result = await handleSchedule({ access_token: 'test-token' }, definition, initialState);
  expect(activities(result).map(message => message.data.sourceURL)).toEqual([
    expect.stringContaining('/remaining'),
  ]);
  expect(checkpoint(result)?.lastSyncTime).toBe(new Date(firstTime + 1000).toISOString());
});
