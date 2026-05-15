import { describe, it, expect, vi } from 'vitest';
import { callYnabTool } from '../tools';
import type { AxiosInstance } from 'axios';

function makeTransaction(i: number) {
  return {
    id: `tx-${i}`,
    date: '2024-01-01',
    amount: -10000 * i,
    payee_name: `Payee ${i}`,
    category_name: `Category ${i}`,
    memo: `Memo ${i}`,
    cleared: 'cleared',
    approved: true,
    account_name: 'Checking',
  };
}

function makeMockClient(responseData: object): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: { data: responseData } }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  } as unknown as AxiosInstance;
}

describe('ynab_list_transactions - full pagination', () => {
  it('returns all transactions when count exceeds 50', async () => {
    const transactions = Array.from({ length: 100 }, (_, i) => makeTransaction(i + 1));
    const client = makeMockClient({ transactions });

    const result = await callYnabTool(
      'ynab_list_transactions',
      { budget_id: 'budget-1' },
      client
    );

    const text = result.content[0].text as string;
    expect(text).toContain('Found 100 transactions');
    expect(text).toContain('tx-100');
    expect(text).not.toContain('showing up to 50');
  });

  it('returns all transactions when count is exactly 50', async () => {
    const transactions = Array.from({ length: 50 }, (_, i) => makeTransaction(i + 1));
    const client = makeMockClient({ transactions });

    const result = await callYnabTool(
      'ynab_list_transactions',
      { budget_id: 'budget-1' },
      client
    );

    const text = result.content[0].text as string;
    expect(text).toContain('tx-50');
  });
});

describe('ynab_list_account_transactions - full pagination', () => {
  it('returns all transactions when count exceeds 50', async () => {
    const transactions = Array.from({ length: 75 }, (_, i) => makeTransaction(i + 1));
    const client = makeMockClient({ transactions });

    const result = await callYnabTool(
      'ynab_list_account_transactions',
      { budget_id: 'budget-1', account_id: 'account-1' },
      client
    );

    const text = result.content[0].text as string;
    expect(text).toContain('Found 75 transactions');
    expect(text).toContain('tx-75');
  });
});

describe('ynab_list_category_transactions - full pagination', () => {
  it('returns all transactions when count exceeds 50', async () => {
    const transactions = Array.from({ length: 60 }, (_, i) => makeTransaction(i + 1));
    const client = makeMockClient({ transactions });

    const result = await callYnabTool(
      'ynab_list_category_transactions',
      { budget_id: 'budget-1', category_id: 'category-1' },
      client
    );

    const text = result.content[0].text as string;
    expect(text).toContain('Found 60 transactions');
    expect(text).toContain('tx-60');
  });
});

describe('ynab_list_payee_transactions - full pagination', () => {
  it('returns all transactions when count exceeds 50', async () => {
    const transactions = Array.from({ length: 80 }, (_, i) => makeTransaction(i + 1));
    const client = makeMockClient({ transactions });

    const result = await callYnabTool(
      'ynab_list_payee_transactions',
      { budget_id: 'budget-1', payee_id: 'payee-1' },
      client
    );

    const text = result.content[0].text as string;
    expect(text).toContain('Found 80 transactions');
    expect(text).toContain('tx-80');
  });
});
