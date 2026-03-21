import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

function createMetaClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: META_API_BASE,
    params: {
      access_token: accessToken,
    },
  });
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const ListAdAccountsSchema = z.object({
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListCampaignsSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  status_filter: z
    .array(z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']))
    .optional()
    .describe('Filter campaigns by status. Defaults to all statuses.'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListAdSetsSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  campaign_id: z.string().optional().describe('Filter ad sets by campaign ID'),
  status_filter: z
    .array(z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']))
    .optional()
    .describe('Filter ad sets by status. Defaults to all statuses.'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListAdsSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  campaign_id: z.string().optional().describe('Filter ads by campaign ID'),
  adset_id: z.string().optional().describe('Filter ads by ad set ID'),
  status_filter: z
    .array(z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']))
    .optional()
    .describe('Filter ads by status. Defaults to all statuses.'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const GetInsightsSchema = z.object({
  object_id: z
    .string()
    .describe(
      'ID of the object to get insights for. Can be an ad account (act_xxx), campaign, ad set, or ad ID.',
    ),
  level: z
    .enum(['account', 'campaign', 'adset', 'ad'])
    .optional()
    .default('account')
    .describe('Level of aggregation for the insights'),
  date_preset: z
    .enum([
      'today',
      'yesterday',
      'this_month',
      'last_month',
      'this_quarter',
      'last_3d',
      'last_7d',
      'last_14d',
      'last_28d',
      'last_30d',
      'last_90d',
      'last_year',
      'this_year',
    ])
    .optional()
    .default('last_30d')
    .describe('Predefined date range for the insights'),
  time_range: z
    .object({
      since: z.string().describe('Start date in YYYY-MM-DD format'),
      until: z.string().describe('End date in YYYY-MM-DD format'),
    })
    .optional()
    .describe('Custom date range. Overrides date_preset if provided.'),
  fields: z
    .array(z.string())
    .optional()
    .default([
      'impressions',
      'clicks',
      'spend',
      'reach',
      'cpm',
      'cpc',
      'ctr',
      'conversions',
      'cost_per_conversion',
    ])
    .describe(
      'Metrics to retrieve. Common fields: impressions, clicks, spend, reach, cpm, cpc, ctr, conversions, cost_per_conversion.',
    ),
  limit: z.number().optional().default(25).describe('Number of results per page'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

// ============================================================================
// TOOL EXPORT FUNCTION
// ============================================================================

export async function getTools() {
  return [
    {
      name: 'list_ad_accounts',
      description:
        'List all ad accounts accessible to the authenticated user. Returns account IDs, names, currency, timezone, and account status.',
      inputSchema: zodToJsonSchema(ListAdAccountsSchema),
    },
    {
      name: 'list_campaigns',
      description:
        'List campaigns for a given ad account. Returns campaign IDs, names, objectives, status, budget, and schedule.',
      inputSchema: zodToJsonSchema(ListCampaignsSchema),
    },
    {
      name: 'list_ad_sets',
      description:
        'List ad sets for a given ad account, optionally filtered by campaign. Returns ad set IDs, names, targeting, budget, schedule, and status.',
      inputSchema: zodToJsonSchema(ListAdSetsSchema),
    },
    {
      name: 'list_ads',
      description:
        'List ads for a given ad account, optionally filtered by campaign or ad set. Returns ad IDs, names, creative info, and status.',
      inputSchema: zodToJsonSchema(ListAdsSchema),
    },
    {
      name: 'get_insights',
      description:
        'Retrieve performance insights (impressions, clicks, spend, reach, CTR, CPC, conversions, etc.) for an ad account, campaign, ad set, or ad over a specified time range.',
      inputSchema: zodToJsonSchema(GetInsightsSchema),
    },
  ];
}

// ============================================================================
// TOOL CALL HANDLERS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>,
) {
  const accessToken = config?.access_token || config?.mcp?.tokens?.access_token;
  const client = createMetaClient(accessToken);

  try {
    switch (name) {
      case 'list_ad_accounts': {
        const { limit, after } = ListAdAccountsSchema.parse(args);
        const params: Record<string, any> = {
          fields: 'id,name,currency,timezone_name,account_status,business',
          limit,
        };
        if (after) params.after = after;

        const response = await client.get('/me/adaccounts', { params });
        const accounts = response.data.data || [];
        const paging = response.data.paging;

        const formatted = accounts
          .map((acc: any) => {
            const statusMap: Record<number, string> = {
              1: 'ACTIVE',
              2: 'DISABLED',
              3: 'UNSETTLED',
              7: 'PENDING_REVIEW',
              9: 'IN_GRACE_PERIOD',
              101: 'TEMPORARILY_UNAVAILABLE',
              100: 'PENDING_CLOSURE',
            };
            const status = statusMap[acc.account_status] ?? String(acc.account_status);
            return `ID: ${acc.id} | Name: ${acc.name}
Currency: ${acc.currency} | Timezone: ${acc.timezone_name}
Status: ${status}${acc.business ? ` | Business: ${acc.business.name}` : ''}`;
          })
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Ad Accounts (${accounts.length}):\n\n${formatted}${pagination}`
                : 'No ad accounts found.',
            },
          ],
        };
      }

      case 'list_campaigns': {
        const { ad_account_id, status_filter, limit, after } = ListCampaignsSchema.parse(args);
        const params: Record<string, any> = {
          fields:
            'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time',
          limit,
        };
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }
        if (after) params.after = after;

        const response = await client.get(`/${ad_account_id}/campaigns`, { params });
        const campaigns = response.data.data || [];
        const paging = response.data.paging;

        const formatted = campaigns
          .map((c: any) => {
            const budget = c.daily_budget
              ? `Daily: ${(parseInt(c.daily_budget) / 100).toFixed(2)}`
              : c.lifetime_budget
                ? `Lifetime: ${(parseInt(c.lifetime_budget) / 100).toFixed(2)}`
                : 'No budget set';
            return `ID: ${c.id} | Name: ${c.name}
Objective: ${c.objective} | Status: ${c.effective_status}
Budget: ${budget}${c.start_time ? ` | Start: ${c.start_time}` : ''}${c.stop_time ? ` | End: ${c.stop_time}` : ''}`;
          })
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Campaigns for ${ad_account_id} (${campaigns.length}):\n\n${formatted}${pagination}`
                : `No campaigns found for ${ad_account_id}.`,
            },
          ],
        };
      }

      case 'list_ad_sets': {
        const { ad_account_id, campaign_id, status_filter, limit, after } =
          ListAdSetsSchema.parse(args);
        const params: Record<string, any> = {
          fields:
            'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting,start_time,end_time,optimization_goal,billing_event',
          limit,
        };
        if (campaign_id) params.campaign_id = campaign_id;
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }
        if (after) params.after = after;

        const response = await client.get(`/${ad_account_id}/adsets`, { params });
        const adsets = response.data.data || [];
        const paging = response.data.paging;

        const formatted = adsets
          .map((s: any) => {
            const budget = s.daily_budget
              ? `Daily: ${(parseInt(s.daily_budget) / 100).toFixed(2)}`
              : s.lifetime_budget
                ? `Lifetime: ${(parseInt(s.lifetime_budget) / 100).toFixed(2)}`
                : 'No budget set';
            return `ID: ${s.id} | Name: ${s.name}
Campaign ID: ${s.campaign_id} | Status: ${s.effective_status}
Budget: ${budget} | Optimization: ${s.optimization_goal} | Billing: ${s.billing_event}${s.start_time ? ` | Start: ${s.start_time}` : ''}${s.end_time ? ` | End: ${s.end_time}` : ''}`;
          })
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Ad Sets for ${ad_account_id} (${adsets.length}):\n\n${formatted}${pagination}`
                : `No ad sets found for ${ad_account_id}.`,
            },
          ],
        };
      }

      case 'list_ads': {
        const { ad_account_id, campaign_id, adset_id, status_filter, limit, after } =
          ListAdsSchema.parse(args);
        const params: Record<string, any> = {
          fields:
            'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,thumbnail_url},created_time,updated_time',
          limit,
        };
        if (campaign_id) params.campaign_id = campaign_id;
        if (adset_id) params.adset_id = adset_id;
        if (status_filter && status_filter.length > 0) {
          params.effective_status = JSON.stringify(status_filter);
        }
        if (after) params.after = after;

        const response = await client.get(`/${ad_account_id}/ads`, { params });
        const ads = response.data.data || [];
        const paging = response.data.paging;

        const formatted = ads
          .map((ad: any) => {
            return `ID: ${ad.id} | Name: ${ad.name}
Campaign ID: ${ad.campaign_id} | Ad Set ID: ${ad.adset_id}
Status: ${ad.effective_status}${ad.creative ? ` | Creative: ${ad.creative.name || ad.creative.id}` : ''}
Created: ${ad.created_time} | Updated: ${ad.updated_time}`;
          })
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Ads for ${ad_account_id} (${ads.length}):\n\n${formatted}${pagination}`
                : `No ads found for ${ad_account_id}.`,
            },
          ],
        };
      }

      case 'get_insights': {
        const { object_id, level, date_preset, time_range, fields, limit, after } =
          GetInsightsSchema.parse(args);
        const params: Record<string, any> = {
          fields: fields.join(','),
          level,
          limit,
        };
        if (time_range) {
          params.time_range = JSON.stringify(time_range);
        } else {
          params.date_preset = date_preset;
        }
        if (after) params.after = after;

        const response = await client.get(`/${object_id}/insights`, { params });
        const insights = response.data.data || [];
        const paging = response.data.paging;

        if (insights.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No insights data found for ${object_id} in the requested time range.`,
              },
            ],
          };
        }

        const formatted = insights
          .map((row: any) => {
            const lines = [`Period: ${row.date_start} to ${row.date_stop}`];
            if (row.campaign_name) lines.push(`Campaign: ${row.campaign_name}`);
            if (row.adset_name) lines.push(`Ad Set: ${row.adset_name}`);
            if (row.ad_name) lines.push(`Ad: ${row.ad_name}`);

            const metricLines: string[] = [];
            if (row.impressions) metricLines.push(`Impressions: ${parseInt(row.impressions).toLocaleString()}`);
            if (row.reach) metricLines.push(`Reach: ${parseInt(row.reach).toLocaleString()}`);
            if (row.clicks) metricLines.push(`Clicks: ${parseInt(row.clicks).toLocaleString()}`);
            if (row.spend) metricLines.push(`Spend: $${parseFloat(row.spend).toFixed(2)}`);
            if (row.cpm) metricLines.push(`CPM: $${parseFloat(row.cpm).toFixed(2)}`);
            if (row.cpc) metricLines.push(`CPC: $${parseFloat(row.cpc).toFixed(2)}`);
            if (row.ctr) metricLines.push(`CTR: ${parseFloat(row.ctr).toFixed(2)}%`);
            if (row.conversions) {
              const convTotal = Array.isArray(row.conversions)
                ? row.conversions.reduce((sum: number, c: any) => sum + parseInt(c.value || '0'), 0)
                : parseInt(row.conversions);
              metricLines.push(`Conversions: ${convTotal.toLocaleString()}`);
            }
            if (row.cost_per_conversion) {
              const cpp = Array.isArray(row.cost_per_conversion)
                ? row.cost_per_conversion[0]?.value
                : row.cost_per_conversion;
              if (cpp) metricLines.push(`Cost/Conv: $${parseFloat(cpp).toFixed(2)}`);
            }

            // Include any other requested fields not handled above
            const handledFields = new Set([
              'date_start', 'date_stop', 'campaign_name', 'adset_name', 'ad_name',
              'impressions', 'reach', 'clicks', 'spend', 'cpm', 'cpc', 'ctr',
              'conversions', 'cost_per_conversion',
            ]);
            for (const [key, val] of Object.entries(row)) {
              if (!handledFields.has(key) && val !== undefined && val !== null) {
                metricLines.push(`${key}: ${val}`);
              }
            }

            return [...lines, ...metricLines].join('\n');
          })
          .join('\n\n---\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: `Insights for ${object_id} (${insights.length} rows):\n\n${formatted}${pagination}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const apiError = error.response?.data?.error;
    const errorMessage = apiError
      ? `${apiError.message} (code: ${apiError.code}, type: ${apiError.type})`
      : error.message;
    throw new Error(`Meta Ads API Error: ${errorMessage}`);
  }
}
