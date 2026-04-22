import axios, { AxiosInstance } from 'axios';

export const BREX_API_BASE = 'https://platform.brexapis.com';
export const BREX_DASHBOARD_BASE = 'https://dashboard.brex.com';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BrexMoney {
  amount: number; // integer in minor units (cents for USD)
  currency: string;
}

export interface BrexCardAccount {
  id: string;
  name?: string;
  status?: string;
  current_balance?: BrexMoney;
  available_balance?: BrexMoney;
  account_number?: string;
  routing_number?: string;
  primary?: boolean;
}

export interface BrexMerchant {
  raw_descriptor?: string;
  mcc?: string;
  country?: string;
}

export interface BrexTransaction {
  id: string;
  description?: string;
  amount: BrexMoney;
  posted_at_date: string; // YYYY-MM-DD
  initiated_at_date?: string;
  card_id?: string;
  merchant?: BrexMerchant;
  card_metadata?: Record<string, unknown>;
  type?: string;
  memo?: string;
}

export interface BrexStatement {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  statement_date?: string;
  due_date?: string;
  primary_statement_amount?: BrexMoney;
  period_type?: 'MONTHLY' | 'WEEKLY';
}

export interface BrexListResponse<T> {
  next_cursor?: string | null;
  items: T[];
}

// ─── Client ────────────────────────────────────────────────────────────────

export function createBrexClient(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: BREX_API_BASE,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

// ─── Formatters ────────────────────────────────────────────────────────────

export function formatMoney(money: BrexMoney | undefined | null): string {
  if (!money || typeof money.amount !== 'number') return '';
  const amount = money.amount / 100;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount).toFixed(2);
  return `${sign}$${abs} ${money.currency || 'USD'}`;
}

export function buildTransactionActivityText(tx: BrexTransaction, accountName?: string): string {
  const merchantName = tx.merchant?.raw_descriptor || tx.description || '(unknown merchant)';
  const amountStr = formatMoney(tx.amount);
  const onAccount = accountName ? ` on ${accountName}` : '';
  const mccLine = tx.merchant?.mcc ? `**MCC:** ${tx.merchant.mcc}\n` : '';
  const memo = tx.memo ? `\n> ${tx.memo}` : '';
  return `## 💳 Brex card charge
**Merchant:** ${merchantName}
**Amount:** ${amountStr}
**Posted:** ${tx.posted_at_date}${onAccount}
${mccLine}${memo}`.trim();
}

export function buildStatementActivityText(statement: BrexStatement): string {
  const amount = formatMoney(statement.primary_statement_amount);
  const dueLine = statement.due_date ? `\n**Due date:** ${statement.due_date}` : '';
  return `## 🧾 Brex statement issued
**Period:** ${statement.start_date} → ${statement.end_date}
**Amount due:** ${amount}${dueLine}`;
}

export function brexDashboardUrl(path: string = ''): string {
  if (!path) return BREX_DASHBOARD_BASE;
  return `${BREX_DASHBOARD_BASE}${path.startsWith('/') ? path : '/' + path}`;
}

// ─── Date helpers ──────────────────────────────────────────────────────────

/**
 * Convert an ISO timestamp to Brex's YYYY-MM-DD filter format.
 * Brex transactions use posted_at_date (date only).
 */
export function toBrexDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Default sync window when no state exists: last 7 days.
 * Brex statements post monthly so 7 days catches recent transactions without
 * flooding on first run.
 */
export function getDefaultSyncTime(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}
