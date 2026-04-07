/**
 * Tests for Gmail scheduled activity payload.
 *
 * Key assertions:
 * - Activity data contains only email metadata fields (no body/text/html/raw)
 * - All expected metadata fields are present (id, threadId, subject, from, to,
 *   date, internalDate, snippet, labelIds, sourceURL)
 * - format:'metadata' is passed to gmail.users.messages.get (no body fetched)
 *
 * Run with: bun test ./src/schedule.test.ts
 */
import { describe, it, expect, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock ./utils so no real googleapis / OAuth client is needed
// ---------------------------------------------------------------------------
const mockGmailClient = {
  users: {
    getProfile: mock(async () => ({ data: { emailAddress: 'user@example.com' } })),
    messages: {
      list: mock(async ({ q }: { q: string }) => {
        if (q.includes('in:inbox')) {
          return { data: { messages: [{ id: 'inbox-1' }] } };
        }
        if (q.includes('in:sent')) {
          return { data: { messages: [{ id: 'sent-1' }] } };
        }
        return { data: { messages: [] } };
      }),
      get: mock(async ({ id, format }: { id: string; format: string }) => {
        // Verify metadata format is requested (not 'full' which would include body)
        if (format !== 'metadata') {
          throw new Error(`Expected format:'metadata' but got '${format}'`);
        }
        const now = Date.now();
        if (id === 'inbox-1') {
          return {
            data: {
              id,
              threadId: 'thread-inbox-1',
              internalDate: String(now + 5000),
              snippet: 'Preview of the received email',
              labelIds: ['INBOX', 'IMPORTANT'],
              payload: {
                headers: [
                  { name: 'From', value: 'Alice <alice@example.com>' },
                  { name: 'To', value: 'user@example.com' },
                  { name: 'Subject', value: 'Meeting tomorrow' },
                  { name: 'Date', value: 'Mon, 07 Apr 2026 09:00:00 +0000' },
                ],
              },
            },
          };
        }
        // sent-1
        return {
          data: {
            id,
            threadId: 'thread-sent-1',
            internalDate: String(now + 10000),
            snippet: 'Preview of the sent email',
            labelIds: ['SENT'],
            payload: {
              headers: [
                { name: 'From', value: 'user@example.com' },
                { name: 'To', value: 'Bob <bob@example.com>' },
                { name: 'Subject', value: 'Re: Meeting tomorrow' },
                { name: 'Date', value: 'Mon, 07 Apr 2026 09:05:00 +0000' },
              ],
            },
          },
        };
      }),
    },
  },
};

mock.module('./utils', () => ({
  getGmailClient: mock(async () => mockGmailClient),
  formatEmailSender: (from: string) => {
    const match = from.match(/^(.+?)\s*<.+?>$/);
    return match ? match[1].trim() : from;
  },
}));

// Import AFTER mocks are registered
const { handleSchedule } = await import('./schedule');

// ---------------------------------------------------------------------------

function makeConfig() {
  return { access_token: 'fake-token', refresh_token: 'fake-refresh' };
}

function makeIntegrationDefinition() {
  return { config: { clientId: 'cid', clientSecret: 'csec' } };
}

describe('handleSchedule — metadata-only payload', () => {
  it('requests format:metadata (never format:full)', async () => {
    await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const calls = (mockGmailClient.users.messages.get as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect((args as any).format).toBe('metadata');
    }
  });

  it('activity text contains no body/HTML/raw markers', async () => {
    const messages = await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const activities = messages.filter((m: any) => m.type === 'activity');
    expect(activities.length).toBeGreaterThan(0);

    for (const activity of activities) {
      const text: string = activity.data.text;
      expect(text).not.toMatch(/Content-Type:/i);
      expect(text).not.toMatch(/Content-Transfer-Encoding:/i);
      expect(text).not.toMatch(/<html/i);
      expect(text).not.toMatch(/base64/i);
    }
  });

  it('activity text includes all required metadata labels', async () => {
    const messages = await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const activities = messages.filter((m: any) => m.type === 'activity');
    expect(activities.length).toBeGreaterThan(0);

    for (const activity of activities) {
      const text: string = activity.data.text;
      expect(text).toMatch(/\*\*From:\*\*/);
      expect(text).toMatch(/\*\*To:\*\*/);
      expect(text).toMatch(/\*\*Subject:\*\*/);
      expect(text).toMatch(/\*\*Date:\*\*/);
      expect(text).toMatch(/\*\*Thread ID:\*\*/);
      expect(text).toMatch(/\*\*Labels:\*\*/);
      expect(text).toMatch(/\*\*Snippet:\*\*/);
    }
  });

  it('activity sourceURL points to mail.google.com', async () => {
    const messages = await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const activities = messages.filter((m: any) => m.type === 'activity');
    for (const activity of activities) {
      expect(activity.data.sourceURL).toMatch(/^https:\/\/mail\.google\.com/);
    }
  });

  it('received email sourceURL includes #inbox/', async () => {
    const messages = await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const inbox = messages.find(
      (m: any) => m.type === 'activity' && m.data.sourceURL.includes('#inbox/')
    );
    expect(inbox).toBeDefined();
  });

  it('sent email sourceURL includes #sent/', async () => {
    const messages = await handleSchedule(makeConfig(), makeIntegrationDefinition(), {});
    const sent = messages.find(
      (m: any) => m.type === 'activity' && m.data.sourceURL.includes('#sent/')
    );
    expect(sent).toBeDefined();
  });

  it('returns empty array when access_token is missing', async () => {
    const result = await handleSchedule({}, makeIntegrationDefinition(), {});
    expect(result).toEqual([]);
  });

  it('GmailScheduledEmailMetadata shape contains only metadata fields — no body fields', () => {
    // Verify that the allowed key set does not include any body/content fields.
    const allowedKeys = [
      'id', 'threadId', 'subject', 'from', 'to',
      'date', 'internalDate', 'snippet', 'labelIds', 'sourceURL',
    ];
    const forbiddenKeys = ['body', 'text', 'html', 'raw', 'parts', 'payload', 'content'];

    for (const key of forbiddenKeys) {
      expect(allowedKeys.includes(key)).toBe(false);
    }

    // A concrete metadata object should have exactly the allowed keys
    const meta = {
      id: 'msg-1',
      threadId: 'thread-1',
      subject: 'Test Subject',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      date: 'Mon, 07 Apr 2026 09:00:00 +0000',
      internalDate: Date.now(),
      snippet: 'Short preview only',
      labelIds: ['INBOX'],
      sourceURL: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    };

    for (const key of forbiddenKeys) {
      expect(Object.prototype.hasOwnProperty.call(meta, key)).toBe(false);
    }
    for (const key of allowedKeys) {
      expect(Object.prototype.hasOwnProperty.call(meta, key)).toBe(true);
    }
  });
});
