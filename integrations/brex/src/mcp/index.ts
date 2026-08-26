/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { BrexTransaction, createBrexClient, formatMoney } from '../utils';

function text(data: unknown) {
  return [{ type: 'text', text: JSON.stringify(data, null, 2) }];
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListCardAccountsSchema = z.object({});

const ListTransactionsSchema = z.object({
  posted_at_start: z
    .string()
    .optional()
    .describe('Only include transactions posted on or after this date (YYYY-MM-DD).'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Max transactions to return (1-100). Defaults to 50.'),
  cursor: z.string().optional().describe('Pagination cursor returned from a prior call.'),
});

const ListStatementsSchema = z.object({
  limit: z.number().optional().default(10).describe('Max statements to return. Defaults to 10.'),
  cursor: z.string().optional().describe('Pagination cursor.'),
});

const GetStatementSchema = z.object({
  statement_id: z.string().describe('The Brex statement ID.'),
});

const TopMerchantsSchema = z.object({
  posted_at_start: z
    .string()
    .optional()
    .describe(
      'Aggregate transactions posted on or after this date (YYYY-MM-DD). Defaults to 30 days ago.',
    ),
  top_n: z.number().optional().default(10).describe('Number of top merchants to return (1-25).'),
});

// ─── Tool definitions ───────────────────────────────────────────────────────

export function getTools() {
  return [
    {
      name: 'list_card_accounts',
      description:
        'List your Brex card accounts (primary and sub-accounts), with balances and status.',
      inputSchema: zodToJsonSchema(ListCardAccountsSchema),
    },
    {
      name: 'list_transactions',
      description:
        'List settled Brex card transactions for the primary card account. Supports date filter and cursor pagination.',
      inputSchema: zodToJsonSchema(ListTransactionsSchema),
    },
    {
      name: 'list_statements',
      description: 'List Brex card statements for the primary card account (most recent first).',
      inputSchema: zodToJsonSchema(ListStatementsSchema),
    },
    {
      name: 'get_statement',
      description: 'Get a single Brex statement by ID, including amount due and period.',
      inputSchema: zodToJsonSchema(GetStatementSchema),
    },
    {
      name: 'get_top_merchants',
      description:
        'Aggregate the primary card account transactions by merchant and return the top N merchants by spend.',
      inputSchema: zodToJsonSchema(TopMerchantsSchema),
    },
  ];
}

// ─── Tool execution ─────────────────────────────────────────────────────────

async function paginatedTransactions(
  client: AxiosInstance,
  posted_at_start: string,
  maxPages = 10,
): Promise<BrexTransaction[]> {
  const all: BrexTransaction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, unknown> = {
      posted_at_start,
      limit: 100,
    };
    if (cursor) params.cursor = cursor;
    const resp = await client.get('/v2/transactions/card/primary', { params });
    const items: BrexTransaction[] = resp.data?.items ?? [];
    all.push(...items);
    cursor = resp.data?.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return all;
}

async function dispatch(name: string, args: Record<string, any>, client: AxiosInstance) {
  switch (name) {
    case 'list_card_accounts': {
      const resp = await client.get('/v2/accounts/card');
      return text(resp.data);
    }

    case 'list_transactions': {
      const { posted_at_start, limit, cursor } = ListTransactionsSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (posted_at_start) params.posted_at_start = posted_at_start;
      if (cursor) params.cursor = cursor;
      const resp = await client.get('/v2/transactions/card/primary', { params });
      return text(resp.data);
    }

    case 'list_statements': {
      const { limit, cursor } = ListStatementsSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (cursor) params.cursor = cursor;
      const resp = await client.get('/v2/accounts/card/primary/statements', { params });
      return text(resp.data);
    }

    case 'get_statement': {
      const { statement_id } = GetStatementSchema.parse(args);
      // Brex statements are listed under the account; fetch and filter.
      // If a direct GET exists server-side, we'd call it; otherwise we page.
      const resp = await client.get('/v2/accounts/card/primary/statements', {
        params: { limit: 100 },
      });
      const items = resp.data?.items ?? [];
      const match = items.find((s: { id?: string }) => s.id === statement_id);
      if (!match) {
        return [{ type: 'text', text: `Statement ${statement_id} not found.` }];
      }
      return text(match);
    }

    case 'get_top_merchants': {
      const { posted_at_start, top_n } = TopMerchantsSchema.parse(args);
      const startDate =
        posted_at_start ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const txns = await paginatedTransactions(client, startDate);

      const byMerchant = new Map<
        string,
        { merchant: string; total: number; currency: string; count: number }
      >();
      for (const tx of txns) {
        const merchant = tx.merchant?.raw_descriptor || tx.description || '(unknown)';
        const current = byMerchant.get(merchant) ?? {
          merchant,
          total: 0,
          currency: tx.amount?.currency ?? 'USD',
          count: 0,
        };
        current.total += tx.amount?.amount ?? 0;
        current.count += 1;
        byMerchant.set(merchant, current);
      }

      const top = Array.from(byMerchant.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, top_n)
        .map((m) => ({
          merchant: m.merchant,
          total: formatMoney({ amount: m.total, currency: m.currency }),
          transaction_count: m.count,
        }));

      return text({ since: startDate, top_merchants: top });
    }

    default:
      return null;
  }
}

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>,
) {
  const apiKey = config?.api_key as string | undefined;
  if (!apiKey) {
    return {
      content: [{ type: 'text', text: 'No api_key in Brex config' }],
      isError: true,
    };
  }

  const client = createBrexClient(apiKey);

  try {
    const result = await dispatch(name, args, client);
    if (result !== null) return result;
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (error: any) {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      error.response?.data?.error ||
      error.message ||
      'Unknown error';
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
}
