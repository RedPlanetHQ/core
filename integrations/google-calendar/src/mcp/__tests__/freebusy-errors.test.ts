import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ freebusy: { query } }) } }));

it('distinguishes failed availability lookups from calendars that are free', async () => {
  query.mockResolvedValueOnce({
    data: {
      groups: { 'bad-group': { errors: [{ reason: 'groupTooBig' }] } },
      calendars: {
        'missing-calendar': { errors: [{ reason: 'notFound' }], busy: [] },
        'free-calendar': { busy: [] },
        'busy-calendar': { busy: [{ start: '09:00', end: '10:00' }] },
      },
    },
  });
  const response = await callTool(
    'get_freebusy',
    {
      calendarIds: ['bad-group', 'missing-calendar', 'free-calendar', 'busy-calendar'],
      timeMin: '2026-01-01T09:00:00Z',
      timeMax: '2026-01-01T10:00:00Z',
    },
    '',
    '',
    '',
    {}
  );

  const text = response.content[0].text;
  expect(text).toContain('Calendar: missing-calendar\n  Availability unavailable (notFound)');
  expect(text).toContain('Group: bad-group\n  Availability unavailable (groupTooBig)');
  expect(text).toContain('Calendar: free-calendar\n  No busy times in this period');
  expect(text).toContain('Calendar: busy-calendar\nBusy times:\n  - 09:00 to 10:00');
});
