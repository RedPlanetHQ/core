import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getSearchConsoleClient, withBackoff } from '../utils';

// ─── Schemas ────────────────────────────────────────────────────────────────

const SiteUrlSchema = z.object({
  siteUrl: z
    .string()
    .describe(
      'The URL of the site as returned by list_sites. Use the exact string including protocol, subdomain, sc-domain: prefix, and trailing slash.'
    ),
});

const AddSiteSchema = z.object({
  siteUrl: z
    .string()
    .describe(
      'The URL of the site to add. For URL-prefix properties use https://example.com/ (with trailing slash). For domain properties use sc-domain:example.com.'
    ),
});

const SitemapSchema = z.object({
  siteUrl: z.string().describe('The site URL (exactly as returned by list_sites).'),
  feedpath: z.string().describe('The URL of the sitemap to operate on.'),
});

const ListSitemapsSchema = z.object({
  siteUrl: z.string().describe('The site URL (exactly as returned by list_sites).'),
  sitemapIndex: z.string().optional().describe('Optional sitemap index URL to filter results.'),
});

const SearchAnalyticsSchema = z.object({
  siteUrl: z.string().describe('The site URL (exactly as returned by list_sites).'),
  startDate: z.string().describe('Start date in YYYY-MM-DD format.'),
  endDate: z.string().describe('End date in YYYY-MM-DD format.'),
  dimensions: z
    .array(z.enum(['country', 'device', 'page', 'query', 'searchAppearance', 'date']))
    .optional()
    .describe('Dimensions to group results by.'),
  rowLimit: z
    .number()
    .int()
    .min(1)
    .max(25000)
    .optional()
    .default(1000)
    .describe('Maximum number of rows to return (1–25000, default 1000).'),
  startRow: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Zero-based index of the first row to return.'),
  searchType: z
    .enum(['web', 'image', 'video', 'news', 'googleNews', 'discover'])
    .optional()
    .default('web')
    .describe('The search type to filter on.'),
  dimensionFilterGroups: z.array(z.any()).optional().describe('Optional dimension filter groups.'),
});

const InspectUrlSchema = z.object({
  siteUrl: z
    .string()
    .describe(
      'The site property URL (exactly as returned by list_sites). Must own or have verified this property.'
    ),
  inspectionUrl: z.string().describe('The fully qualified URL to inspect.'),
  languageCode: z
    .string()
    .optional()
    .default('en-US')
    .describe('BCP-47 language code for inspection results (default: en-US).'),
});

// ─── Tools list ──────────────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'list_sites',
      description:
        "List all sites (properties) verified in the user's Google Search Console account.",
      inputSchema: zodToJsonSchema(z.object({})),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_site',
      description: 'Get permission level and details for a specific site property.',
      inputSchema: zodToJsonSchema(SiteUrlSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'add_site',
      description:
        'Add a new site property to Google Search Console. Ownership verification is required separately in GSC.',
      inputSchema: zodToJsonSchema(AddSiteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'delete_site',
      description:
        'Permanently remove a site property from Google Search Console. This action cannot be undone.',
      inputSchema: zodToJsonSchema(SiteUrlSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'list_sitemaps',
      description: 'List all sitemaps submitted for a site property.',
      inputSchema: zodToJsonSchema(ListSitemapsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_sitemap',
      description: 'Get metadata for a specific sitemap. Numeric fields may lag several days.',
      inputSchema: zodToJsonSchema(SitemapSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'submit_sitemap',
      description:
        'Submit a sitemap for a site property. Requires owner or full-user permissions on the property.',
      inputSchema: zodToJsonSchema(SitemapSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_analytics_query',
      description:
        'Query search analytics data (clicks, impressions, CTR, position). Only rows with at least 1 impression are returned.',
      inputSchema: zodToJsonSchema(SearchAnalyticsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'inspect_url',
      description:
        'Inspect a URL using the URL Inspection API. Results reflect cached/indexed state and may lag several days. Applies exponential backoff on quota errors.',
      inputSchema: zodToJsonSchema(InspectUrlSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any
) {
  const gsc = getSearchConsoleClient(clientId, clientSecret, redirectUri || '', config);

  try {
    switch (name) {
      case 'list_sites': {
        const res = await gsc.sites.list();
        const sites = res.data.siteEntry ?? [];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(sites, null, 2),
            },
          ],
        };
      }

      case 'get_site': {
        const { siteUrl } = SiteUrlSchema.parse(args);
        const res = await gsc.sites.get({ siteUrl });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res.data, null, 2),
            },
          ],
        };
      }

      case 'add_site': {
        const { siteUrl } = AddSiteSchema.parse(args);
        await gsc.sites.add({ siteUrl });
        return {
          content: [
            {
              type: 'text',
              text: `Site ${siteUrl} added successfully. Note: ownership verification is required in Google Search Console.`,
            },
          ],
        };
      }

      case 'delete_site': {
        const { siteUrl } = SiteUrlSchema.parse(args);
        await gsc.sites.delete({ siteUrl });
        return {
          content: [
            {
              type: 'text',
              text: `Site ${siteUrl} deleted successfully.`,
            },
          ],
        };
      }

      case 'list_sitemaps': {
        const { siteUrl, sitemapIndex } = ListSitemapsSchema.parse(args);
        const params: Record<string, string> = { siteUrl };
        if (sitemapIndex) {
          params['sitemapIndex'] = sitemapIndex;
        }
        const res = await gsc.sitemaps.list(params);
        const sitemaps = (res.data.sitemap ?? []).map(s => ({
          ...s,
          errors: s.errors !== undefined ? parseInt(String(s.errors), 10) : undefined,
          warnings: s.warnings !== undefined ? parseInt(String(s.warnings), 10) : undefined,
          isPending: s.isPending,
          isSitemapsIndex: s.isSitemapsIndex,
          lastSubmitted: s.lastSubmitted,
          lastDownloaded: s.lastDownloaded,
          path: s.path,
          type: s.type,
          contents: s.contents?.map(c => ({
            ...c,
            submitted: c.submitted !== undefined ? parseInt(String(c.submitted), 10) : undefined,
            indexed: c.indexed !== undefined ? parseInt(String(c.indexed), 10) : undefined,
          })),
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(sitemaps, null, 2),
            },
          ],
        };
      }

      case 'get_sitemap': {
        const { siteUrl, feedpath } = SitemapSchema.parse(args);
        const res = await gsc.sitemaps.get({ siteUrl, feedpath });
        const sitemap = res.data;
        const normalized = {
          ...sitemap,
          errors: sitemap.errors !== undefined ? parseInt(String(sitemap.errors), 10) : undefined,
          warnings:
            sitemap.warnings !== undefined ? parseInt(String(sitemap.warnings), 10) : undefined,
          contents: sitemap.contents?.map(c => ({
            ...c,
            submitted: c.submitted !== undefined ? parseInt(String(c.submitted), 10) : undefined,
            indexed: c.indexed !== undefined ? parseInt(String(c.indexed), 10) : undefined,
          })),
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(normalized, null, 2),
            },
          ],
        };
      }

      case 'submit_sitemap': {
        const { siteUrl, feedpath } = SitemapSchema.parse(args);
        await gsc.sitemaps.submit({ siteUrl, feedpath });
        return {
          content: [
            {
              type: 'text',
              text: `Sitemap ${feedpath} submitted successfully for ${siteUrl}.`,
            },
          ],
        };
      }

      case 'search_analytics_query': {
        const validated = SearchAnalyticsSchema.parse(args);
        const res = await gsc.searchanalytics.query({
          siteUrl: validated.siteUrl,
          requestBody: {
            startDate: validated.startDate,
            endDate: validated.endDate,
            dimensions: validated.dimensions,
            rowLimit: validated.rowLimit,
            startRow: validated.startRow,
            searchType: validated.searchType,
            dimensionFilterGroups: validated.dimensionFilterGroups,
          },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res.data, null, 2),
            },
          ],
        };
      }

      case 'inspect_url': {
        const validated = InspectUrlSchema.parse(args);
        const res = await withBackoff(() =>
          gsc.urlInspection.index.inspect({
            requestBody: {
              siteUrl: validated.siteUrl,
              inspectionUrl: validated.inspectionUrl,
              languageCode: validated.languageCode,
            },
          })
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res.data, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error: unknown) {
    const err = error as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    if (err?.response?.status === 429) {
      return {
        content: [
          {
            type: 'text',
            text: `Quota exceeded (HTTP 429). The Search Console API limit has been reached. Please wait before retrying.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err?.message ?? String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
