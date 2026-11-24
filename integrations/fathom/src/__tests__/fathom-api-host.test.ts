import { expect, it, vi } from 'vitest';
import { fathomGet } from '../utils';

const { create, get } = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock('axios', () => ({ default: { create } }));

it('sends Fathom reads to the documented API host', async () => {
  create.mockReturnValue({ get });
  get.mockResolvedValue({ data: { items: [] } });

  await fathomGet('test-key', '/meetings');

  expect(create).toHaveBeenCalledWith({
    baseURL: 'https://api.fathom.ai/external/v1',
    headers: { 'X-Api-Key': 'test-key', 'Content-Type': 'application/json' },
  });
  expect(get).toHaveBeenCalledWith('/meetings', { params: {} });
});
