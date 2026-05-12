import { getDataClient, GAConfig, withBackoff } from './utils';

interface GASettings {
  lastSummaryTime?: string;
}

interface ReportRow {
  dimensionValues?: Array<{ value?: string | null }>;
  metricValues?: Array<{ value?: string | null }>;
}

function formatNumber(value: string | null | undefined): string {
  const n = parseFloat(value ?? '0');
  if (isNaN(n)) return value ?? '0';
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toFixed(2);
}

/**
 * Build a markdown summary table from GA4 report rows.
 * Expects rows with dimension "date" + metrics sessions, activeUsers, screenPageViews.
 */
function buildSummaryMarkdown(
  rows: ReportRow[],
  propertyId: string,
  propertyLabel: string
): string {
  if (!rows || rows.length === 0) {
    return `_No data returned for this period._`;
  }

  let totalSessions = 0;
  let totalActiveUsers = 0;
  let totalPageViews = 0;
  const dailyRows: string[] = [];

  for (const row of rows) {
    const date = row.dimensionValues?.[0]?.value ?? '';
    const sessions = parseFloat(row.metricValues?.[0]?.value ?? '0');
    const activeUsers = parseFloat(row.metricValues?.[1]?.value ?? '0');
    const pageViews = parseFloat(row.metricValues?.[2]?.value ?? '0');

    totalSessions += sessions;
    totalActiveUsers += activeUsers;
    totalPageViews += pageViews;

    // Format YYYYMMDD → YYYY-MM-DD
    const formatted =
      date.length === 8
        ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        : date;

    dailyRows.push(
      `| ${formatted} | ${formatNumber(String(sessions))} | ${formatNumber(String(activeUsers))} | ${formatNumber(String(pageViews))} |`
    );
  }

  const table = [
    '| Date | Sessions | Active Users | Page Views |',
    '|------|----------|-------------|------------|',
    ...dailyRows,
    `| **Total** | **${formatNumber(String(totalSessions))}** | **${formatNumber(String(totalActiveUsers))}** | **${formatNumber(String(totalPageViews))}** |`,
  ].join('\n');

  const title = propertyLabel !== propertyId ? `${propertyLabel} (${propertyId})` : propertyId;

  return `## Google Analytics — Traffic Summary\n\n**Property:** ${title}\n\n${table}`;
}

export async function handleSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  integrationDefinition?: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state?: Record<string, any>
) {
  try {
    if (!config?.access_token) {
      return [];
    }

    const propertyId: string | null = config.defaultPropertyId ?? null;
    if (!propertyId) {
      // No default property — nothing to report
      return [];
    }

    const gaConfig: GAConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token ?? '',
      client_id: integrationDefinition?.config?.clientId ?? '',
      client_secret: integrationDefinition?.config?.clientSecret ?? '',
      token_type: config.token_type,
      expires_at: config.expires_at,
      scope: config.scope,
      redirect_uri: config.redirect_uri,
      defaultPropertyId: propertyId,
      availableProperties: config.availableProperties,
    };

    const settings = ((state ?? {}) as GASettings);

    // Determine the date range: last 7 days ending today so every 6h run shows
    // a useful recent window rather than duplicating per-run data.
    const endDate = 'yesterday';
    const startDate = '7daysAgo';

    const dataClient = getDataClient(
      gaConfig.client_id,
      gaConfig.client_secret,
      gaConfig.redirect_uri ?? '',
      gaConfig
    );

    const res = await withBackoff(() =>
      dataClient.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
        },
      })
    );

    const rows = (res.data.rows ?? []) as ReportRow[];

    const propertyLabel =
      gaConfig.availableProperties?.find(p => p.id === propertyId)?.displayName ?? propertyId;

    const summaryText = buildSummaryMarkdown(rows, propertyId, propertyLabel);
    const sourceURL = `https://analytics.google.com/analytics/web/#/p${propertyId}/reports/intelligenthome`;

    const messages: object[] = [
      {
        type: 'activity',
        data: {
          text: summaryText,
          sourceURL,
        },
      },
    ];

    // Persist state so downstream logic can track last run time if needed
    const nowIso = new Date().toISOString();
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSummaryTime: nowIso,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in GA handleSchedule:', error);
    return [];
  }
}
