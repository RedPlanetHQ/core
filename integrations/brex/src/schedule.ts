import { AxiosInstance } from 'axios';

import {
  BrexStatement,
  BrexTransaction,
  brexDashboardUrl,
  buildStatementActivityText,
  buildTransactionActivityText,
  createBrexClient,
  getDefaultSyncTime,
  toBrexDate,
} from './utils';

interface BrexState {
  lastSyncTime?: string;
  seenTransactionIds?: string[];
  seenStatementIds?: string[];
}

interface BrexConfig {
  api_key?: string;
  primaryCardAccountId?: string;
  primaryCardAccountName?: string;
}

// Cap seen-id windows so state doesn't grow unbounded. 500 tx comfortably covers
// ~2 weeks of spend for a typical Brex account at the 4h poll cadence.
const MAX_SEEN_TXN_IDS = 500;
const MAX_SEEN_STATEMENT_IDS = 50;

function activityMessage(text: string, sourceURL: string) {
  return {
    type: 'activity' as const,
    data: { text, sourceURL },
  };
}

async function fetchNewTransactions(
  client: AxiosInstance,
  postedAtStart: string,
  seen: Set<string>,
): Promise<BrexTransaction[]> {
  const results: BrexTransaction[] = [];
  let cursor: string | undefined = undefined;

  // Paginate. Brex limit max is 1000 but 100 is the documented default and
  // safer under rate limits. ~10 page cap to avoid runaway loops on first sync.
  for (let page = 0; page < 10; page += 1) {
    const params: Record<string, unknown> = {
      posted_at_start: postedAtStart,
      limit: 100,
    };
    if (cursor) params.cursor = cursor;

    const resp = await client.get('/v2/transactions/card/primary', { params });
    const items: BrexTransaction[] = resp.data?.items ?? [];

    for (const tx of items) {
      if (!tx?.id || seen.has(tx.id)) continue;
      results.push(tx);
    }

    cursor = resp.data?.next_cursor ?? undefined;
    if (!cursor) break;
  }

  return results;
}

async function fetchNewStatements(
  client: AxiosInstance,
  seen: Set<string>,
): Promise<BrexStatement[]> {
  const resp = await client.get('/v2/accounts/card/primary/statements', {
    params: { limit: 10 },
  });
  const items: BrexStatement[] = resp.data?.items ?? [];
  return items.filter((s) => s?.id && !seen.has(s.id));
}

export const handleSchedule = async (
  config?: BrexConfig,
  _integrationDefinition?: unknown,
  state?: BrexState,
) => {
  if (!config?.api_key) {
    return [];
  }

  const settings: BrexState = state ?? {};
  const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
  const postedAtStart = toBrexDate(lastSyncTime);

  const seenTxIds = new Set(settings.seenTransactionIds ?? []);
  const seenStatementIds = new Set(settings.seenStatementIds ?? []);

  const client = createBrexClient(config.api_key);
  const messages: Array<
    | { type: 'activity'; data: { text: string; sourceURL: string } }
    | { type: 'state'; data: BrexState }
  > = [];

  try {
    const newTxns = await fetchNewTransactions(client, postedAtStart, seenTxIds);
    for (const tx of newTxns) {
      messages.push(
        activityMessage(
          buildTransactionActivityText(tx, config.primaryCardAccountName),
          brexDashboardUrl('/transactions'),
        ),
      );
      seenTxIds.add(tx.id);
    }
  } catch (error) {
    console.error('[brex] error fetching transactions:', error);
  }

  try {
    const newStatements = await fetchNewStatements(client, seenStatementIds);
    for (const st of newStatements) {
      messages.push(
        activityMessage(
          buildStatementActivityText(st),
          brexDashboardUrl('/account-and-payments/statements'),
        ),
      );
      seenStatementIds.add(st.id);
    }
  } catch (error) {
    console.error('[brex] error fetching statements:', error);
  }

  const cappedTxIds = Array.from(seenTxIds).slice(-MAX_SEEN_TXN_IDS);
  const cappedStatementIds = Array.from(seenStatementIds).slice(-MAX_SEEN_STATEMENT_IDS);

  messages.push({
    type: 'state',
    data: {
      ...settings,
      lastSyncTime: new Date().toISOString(),
      seenTransactionIds: cappedTxIds,
      seenStatementIds: cappedStatementIds,
    },
  });

  return messages;
};

// Exported for unit tests.
export const _internals = {
  fetchNewTransactions,
  fetchNewStatements,
  MAX_SEEN_TXN_IDS,
  MAX_SEEN_STATEMENT_IDS,
};
