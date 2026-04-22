import { describe, expect, it } from 'vitest';

import {
  BrexStatement,
  BrexTransaction,
  brexDashboardUrl,
  buildStatementActivityText,
  buildTransactionActivityText,
  createBrexClient,
  formatMoney,
  getDefaultSyncTime,
  toBrexDate,
} from '../utils';

describe('formatMoney', () => {
  it('formats positive USD cents to dollars', () => {
    expect(formatMoney({ amount: 252302, currency: 'USD' })).toBe('$2523.02 USD');
  });

  it('formats negative amounts with leading minus', () => {
    expect(formatMoney({ amount: -1050, currency: 'USD' })).toBe('-$10.50 USD');
  });

  it('preserves non-USD currency codes', () => {
    expect(formatMoney({ amount: 1000, currency: 'EUR' })).toBe('$10.00 EUR');
  });

  it('returns empty string for undefined or malformed input', () => {
    expect(formatMoney(undefined)).toBe('');
    expect(formatMoney(null)).toBe('');
    // missing amount
    expect(
      formatMoney({ currency: 'USD' } as unknown as { amount: number; currency: string }),
    ).toBe('');
  });
});

describe('toBrexDate', () => {
  it('slices the ISO timestamp to YYYY-MM-DD', () => {
    expect(toBrexDate('2026-04-22T17:55:00.000Z')).toBe('2026-04-22');
  });
});

describe('getDefaultSyncTime', () => {
  it('returns an ISO timestamp ~7 days ago', () => {
    const iso = getDefaultSyncTime();
    const diffMs = Date.now() - new Date(iso).getTime();
    // Between 6.5 and 7.5 days, accounting for execution time
    expect(diffMs).toBeGreaterThan(6.5 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(7.5 * 24 * 60 * 60 * 1000);
  });
});

describe('buildTransactionActivityText', () => {
  const tx: BrexTransaction = {
    id: 'tx_1',
    posted_at_date: '2026-04-20',
    amount: { amount: 4999, currency: 'USD' },
    merchant: { raw_descriptor: 'AWS', mcc: '7372' },
    memo: 'Infra bill',
  };

  it('includes merchant, amount, date, mcc, memo', () => {
    const text = buildTransactionActivityText(tx, 'Poozle Inc. Card');
    expect(text).toContain('AWS');
    expect(text).toContain('$49.99 USD');
    expect(text).toContain('2026-04-20');
    expect(text).toContain('Poozle Inc. Card');
    expect(text).toContain('7372');
    expect(text).toContain('Infra bill');
  });

  it('falls back to description when merchant.raw_descriptor is missing', () => {
    const text = buildTransactionActivityText(
      { ...tx, merchant: undefined, description: 'AMAZON WEB SVCS' },
      undefined,
    );
    expect(text).toContain('AMAZON WEB SVCS');
    expect(text).not.toContain('MCC:');
  });
});

describe('buildStatementActivityText', () => {
  it('includes period, amount due, and due date', () => {
    const statement: BrexStatement = {
      id: 'st_1',
      start_date: '2026-03-26',
      end_date: '2026-04-25',
      due_date: '2026-04-28',
      primary_statement_amount: { amount: 252302, currency: 'USD' },
    };
    const text = buildStatementActivityText(statement);
    expect(text).toContain('2026-03-26');
    expect(text).toContain('2026-04-25');
    expect(text).toContain('$2523.02 USD');
    expect(text).toContain('2026-04-28');
  });

  it('omits due date line when missing', () => {
    const statement: BrexStatement = {
      id: 'st_1',
      start_date: '2026-03-26',
      end_date: '2026-04-25',
      primary_statement_amount: { amount: 100, currency: 'USD' },
    };
    const text = buildStatementActivityText(statement);
    expect(text).not.toContain('Due date:');
  });
});

describe('brexDashboardUrl', () => {
  it('returns base when no path', () => {
    expect(brexDashboardUrl()).toBe('https://dashboard.brex.com');
  });

  it('prepends leading slash when missing', () => {
    expect(brexDashboardUrl('transactions')).toBe('https://dashboard.brex.com/transactions');
    expect(brexDashboardUrl('/transactions')).toBe('https://dashboard.brex.com/transactions');
  });
});

describe('createBrexClient', () => {
  it('sets baseURL and Authorization header', () => {
    const client = createBrexClient('test-key-123');
    expect(client.defaults.baseURL).toBe('https://platform.brexapis.com');
    expect(client.defaults.headers.Authorization).toBe('Bearer test-key-123');
  });
});
