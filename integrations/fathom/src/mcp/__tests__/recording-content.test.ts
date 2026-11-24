import { beforeEach, expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

beforeEach(() => get.mockReset());

it.each([
  ['fathom_get_meeting_transcript', { meeting_id: '123' }],
  ['fathom_get_recording_transcript', { recording_id: '123' }],
] as const)('%s reads the transcript envelope and its speaker and time', async (tool, args) => {
  get.mockResolvedValueOnce({
    data: {
      transcript: [{ speaker: { display_name: 'Alice' }, timestamp: '00:01:05', text: 'Hello' }],
    },
  });
  const result = await callTool(tool, args, { api_key: 'test' });
  expect(get).toHaveBeenCalledWith('/recordings/123/transcript', { params: {} });
  expect(result.content[0].text).toContain('[00:01:05] Alice: Hello');
});

it('reads the markdown summary from the recording endpoint', async () => {
  get.mockResolvedValueOnce({ data: { summary: { markdown_formatted: '## Decisions' } } });
  const result = await callTool(
    'fathom_get_meeting_summary',
    { meeting_id: '123' },
    { api_key: 'test' }
  );
  expect(get).toHaveBeenCalledWith('/recordings/123/summary', { params: {} });
  expect(result.content[0].text).toBe('## Decisions');
});
