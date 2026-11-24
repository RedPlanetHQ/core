import { expect, it, vi } from 'vitest';
import { callTool } from '../index';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

it('reads the provider team list and exposes its continuation', async () => {
  get.mockResolvedValueOnce({ data: { items: [{ name: 'Sales' }], next_cursor: 'next-team' } });
  const result = await callTool('fathom_list_teams', {}, { api_key: 'test' });
  expect(result.content[0].text).toContain('Name: Sales');
  expect(result.content[0].text).toContain('Next page cursor: next-team');
  expect(result.content[0].text).not.toContain('undefined');
});

it('requests team members using the team name and cursor', async () => {
  get.mockResolvedValueOnce({
    data: { items: [{ name: 'Alice', email: 'a@example.com' }], next_cursor: null },
  });
  const result = await callTool(
    'fathom_list_team_members',
    { team_id: 'Sales', cursor: 'next-member' },
    { api_key: 'test' }
  );
  expect(get).toHaveBeenLastCalledWith('/team_members', {
    params: { team: 'Sales', cursor: 'next-member' },
  });
  expect(result.content[0].text).toContain('Alice (a@example.com)');
});
