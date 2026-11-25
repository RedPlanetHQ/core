import { expect, it, vi } from 'vitest';

import { integrationCreate } from '../account-create';
import { identify } from '../identify';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

it('uses a recorder email from the meetings list as the webhook identifier', async () => {
  const recorded_by = { name: 'Alice', email: 'alice@example.com' };
  get.mockResolvedValueOnce({ data: { items: [{ name: 'Engineering' }], next_cursor: null } });
  get.mockResolvedValueOnce({ data: { items: [{ recorded_by }], next_cursor: 'next' } });

  const [account] = await integrationCreate({ api_key: 'test-key', webhook_secret: 'secret' });

  expect(account.data.accountId).toBe(recorded_by.email);
  expect(account.data.settings).toEqual({ team: 'Engineering' });
  expect(get).toHaveBeenCalledTimes(2);
  expect(await identify(undefined, { recorded_by })).toEqual([
    { type: 'identifier', data: account.data.accountId },
  ]);
  expect(await identify(undefined, { data: { recorded_by: recorded_by.email } })).toEqual([
    { type: 'identifier', data: account.data.accountId },
  ]);
});
