import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ events: { get, update } }) } }));

it('uses the version read from Calendar and surfaces a concurrent edit', async () => {
  const etag = '"event-v1"';
  get.mockResolvedValueOnce({ data: { etag, summary: 'Original title', description: 'Notes' } });
  update.mockImplementationOnce(async (_params, options) => {
    if (options?.headers?.['If-Match'] === etag) {
      throw Object.assign(new Error('Precondition Failed'), { status: 412 });
    }
    return { data: { summary: 'New title' } };
  });

  const result = await callTool(
    'update_event',
    { eventId: 'event', summary: 'New title' },
    '',
    '',
    '',
    {}
  );

  expect(update).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ requestBody: { etag, summary: 'New title', description: 'Notes' } }),
    { headers: { 'If-Match': etag } }
  );
  expect(result.content[0].text).toContain('Error: Precondition Failed');
});
