import { beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ events: client }) } }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials() {}
    refreshAccessToken() {
      return Promise.resolve({ credentials: {} });
    }
  },
}));
import { callTool } from '../index';

const existing = {
  id: 'event-1',
  summary: 'Planning',
  description: 'Private notes',
  location: 'Room 3',
  start: { dateTime: '2026-11-16T09:00:00Z', timeZone: 'UTC' },
  end: { dateTime: '2026-11-16T10:00:00Z', timeZone: 'UTC' },
  attendees: [{ email: 'teammate@example.com' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: structuredClone(existing) });
  client.update.mockImplementation(async ({ requestBody }) => ({ data: requestBody }));
});
const update = (args: Record<string, unknown>) =>
  callTool(
    'update_event',
    { eventId: 'event-1', ...args },
    'test-client',
    'test-secret',
    'http://localhost/callback',
    { access_token: 'test' }
  );

describe('Google Calendar optional text updates', () => {
  it.each(['summary', 'description', 'location'])('clears an explicitly empty %s', async field => {
    await update({ [field]: '' });
    expect(client.update).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event-1',
      requestBody: { ...existing, [field]: '' },
    });
  });
  it('preserves omitted fields and the event time/attendees', async () => {
    await update({ summary: 'Updated title' });
    expect(client.update).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event-1',
      requestBody: { ...existing, summary: 'Updated title' },
    });
  });
  it('clears multiple fields in one update', async () => {
    await update({ description: '', location: '' });
    expect(client.update.mock.calls[0][0].requestBody).toEqual({
      ...existing,
      description: '',
      location: '',
    });
  });
  it('preserves intentional whitespace instead of treating it as omission', async () => {
    await update({ description: ' ' });
    expect(client.update.mock.calls[0][0].requestBody.description).toBe(' ');
  });
});
