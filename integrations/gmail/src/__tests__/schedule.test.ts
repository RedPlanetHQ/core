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
  return messages.find((message) => message.type === 'state')?.data;
}
function activities(messages: any[]) {
  return messages.filter((message) => message.type === 'activity');
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
        messages: source.filter((message) => message.time > after).map(({ id }) => ({ id })),
      },
    };
  });
  gmail.get.mockImplementation(async ({ id }: { id: string }) => {
    const message = [...inbox, ...sent].find((message) => message.id === id)!;
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
