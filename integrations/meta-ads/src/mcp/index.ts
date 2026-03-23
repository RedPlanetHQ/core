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

const GetUserSchema = z.object({
  fields: z
    .array(z.string())
    .optional()
    .default(['id', 'name', 'email'])
    .describe('Fields to retrieve for the user'),
});

const GetMetaObjectSchema = z.object({
  object_id: z.string().describe('ID of the Meta object to retrieve'),
  fields: z
    .array(z.string())
    .optional()
    .describe('Fields to retrieve. Defaults to all default fields for the object type.'),
});

const GetPageAccountsSchema = z.object({
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const GetVideoSchema = z.object({
  video_id: z.string().describe('ID of the video to retrieve'),
  fields: z
    .array(z.string())
    .optional()
    .default(['id', 'title', 'description', 'source', 'permalink_url', 'length', 'thumbnails'])
    .describe('Fields to retrieve for the video'),
});

const CreateCampaignSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  name: z.string().describe('Name of the campaign'),
  objective: z
    .enum([
      'OUTCOME_AWARENESS',
      'OUTCOME_TRAFFIC',
      'OUTCOME_ENGAGEMENT',
      'OUTCOME_LEADS',
      'OUTCOME_APP_PROMOTION',
      'OUTCOME_SALES',
    ])
    .describe('Campaign objective'),
  status: z
    .enum(['ACTIVE', 'PAUSED'])
    .optional()
    .default('PAUSED')
    .describe('Initial campaign status'),
  special_ad_categories: z
    .array(z.enum(['NONE', 'EMPLOYMENT', 'HOUSING', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS']))
    .optional()
    .default(['NONE'])
    .describe('Special ad categories if applicable'),
  daily_budget: z
    .number()
    .optional()
    .describe('Daily budget in cents (e.g. 1000 = $10.00). Cannot be used with lifetime_budget.'),
  lifetime_budget: z
    .number()
    .optional()
    .describe(
      'Lifetime budget in cents (e.g. 10000 = $100.00). Cannot be used with daily_budget.',
    ),
  bid_strategy: z
    .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
    .optional()
    .describe('Bidding strategy for the campaign'),
});

const UpdateCampaignSchema = z.object({
  campaign_id: z.string().describe('ID of the campaign to update'),
  name: z.string().optional().describe('New name for the campaign'),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional().describe('New campaign status'),
  daily_budget: z.number().optional().describe('New daily budget in cents'),
  lifetime_budget: z.number().optional().describe('New lifetime budget in cents'),
  bid_strategy: z
    .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
    .optional()
    .describe('New bidding strategy'),
});

const DeleteCampaignSchema = z.object({
  campaign_id: z.string().describe('ID of the campaign to delete'),
});

const CreateAdSetSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  campaign_id: z.string().describe('Campaign ID this ad set belongs to'),
  name: z.string().describe('Name of the ad set'),
  optimization_goal: z
    .enum([
      'NONE',
      'APP_INSTALLS',
      'BRAND_AWARENESS',
      'CLICKS',
      'ENGAGED_USERS',
      'EVENT_RESPONSES',
      'IMPRESSIONS',
      'LEAD_GENERATION',
      'LINK_CLICKS',
      'OFFER_CLAIMS',
      'OFFSITE_CONVERSIONS',
      'PAGE_ENGAGEMENT',
      'PAGE_LIKES',
      'POST_ENGAGEMENT',
      'QUALITY_LEAD',
      'REACH',
      'SOCIAL_IMPRESSIONS',
      'VIDEO_VIEWS',
      'VISIT_INSTAGRAM_PROFILE',
      'VALUE',
      'THRUPLAY',
    ])
    .describe('Optimization goal for the ad set'),
  billing_event: z
    .enum(['APP_INSTALLS', 'CLICKS', 'IMPRESSIONS', 'LINK_CLICKS', 'PAGE_LIKES', 'POST_ENGAGEMENT', 'THRUPLAY', 'VIDEO_VIEWS'])
    .describe('Billing event for the ad set'),
  bid_amount: z.number().optional().describe('Bid amount in cents'),
  daily_budget: z
    .number()
    .optional()
    .describe('Daily budget in cents. Cannot be used with lifetime_budget.'),
  lifetime_budget: z
    .number()
    .optional()
    .describe('Lifetime budget in cents. Cannot be used with daily_budget.'),
  start_time: z.string().optional().describe('Start time in ISO 8601 format'),
  end_time: z.string().optional().describe('End time in ISO 8601 format'),
  status: z
    .enum(['ACTIVE', 'PAUSED'])
    .optional()
    .default('PAUSED')
    .describe('Initial ad set status'),
  targeting: z
    .record(z.any())
    .optional()
    .describe(
      'Targeting spec object. See Meta API docs for full targeting options (geo_locations, age_min, age_max, genders, interests, etc.)',
    ),
});

const CreateAdCreativeSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  name: z.string().describe('Name of the ad creative'),
  object_story_spec: z
    .record(z.any())
    .optional()
    .describe(
      'Object story spec for the creative. Defines the page, link data, video data, etc.',
    ),
  asset_feed_spec: z
    .record(z.any())
    .optional()
    .describe('Asset feed spec for dynamic creative with multiple assets'),
  image_hash: z.string().optional().describe('Hash of an uploaded image to use in the creative'),
  image_url: z.string().optional().describe('URL of an image to use in the creative'),
  video_id: z.string().optional().describe('ID of a video to use in the creative'),
  title: z.string().optional().describe('Title text for the creative'),
  body: z.string().optional().describe('Body text for the creative'),
  link_url: z.string().optional().describe('Destination URL for the ad'),
  call_to_action_type: z
    .string()
    .optional()
    .describe('Call to action type (e.g. LEARN_MORE, SHOP_NOW, SIGN_UP)'),
});

const GetAdCreativeSchema = z.object({
  creative_id: z.string().describe('ID of the ad creative to retrieve'),
  fields: z
    .array(z.string())
    .optional()
    .default([
      'id',
      'name',
      'status',
      'thumbnail_url',
      'object_story_spec',
      'asset_feed_spec',
      'effective_object_story_id',
    ])
    .describe('Fields to retrieve for the creative'),
});

const UpdateAdCreativeSchema = z.object({
  creative_id: z.string().describe('ID of the ad creative to update'),
  name: z.string().optional().describe('New name for the creative'),
  object_story_spec: z.record(z.any()).optional().describe('Updated object story spec'),
  asset_feed_spec: z.record(z.any()).optional().describe('Updated asset feed spec'),
  title: z.string().optional().describe('New title text'),
  body: z.string().optional().describe('New body text'),
});

const DeleteAdCreativeSchema = z.object({
  creative_id: z.string().describe('ID of the ad creative to delete'),
});

const ListAdCreativesSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  fields: z
    .array(z.string())
    .optional()
    .default(['id', 'name', 'status', 'thumbnail_url', 'effective_object_story_id'])
    .describe('Fields to retrieve for each creative'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const PreviewAdCreativeSchema = z.object({
  creative_id: z.string().describe('ID of the ad creative to preview'),
  ad_format: z
    .enum([
      'DESKTOP_FEED_STANDARD',
      'MOBILE_FEED_STANDARD',
      'MOBILE_FEED_BASIC',
      'MOBILE_INTERSTITIAL',
      'INSTAGRAM_STANDARD',
      'INSTAGRAM_STORY',
      'AUDIENCE_NETWORK_OUTSTREAM_VIDEO',
      'RIGHT_COLUMN_STANDARD',
    ])
    .optional()
    .default('DESKTOP_FEED_STANDARD')
    .describe('Ad format for the preview'),
});

const CreateAdSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  name: z.string().describe('Name of the ad'),
  adset_id: z.string().describe('Ad set ID this ad belongs to'),
  creative: z
    .object({
      creative_id: z.string().describe('ID of an existing ad creative'),
    })
    .or(
      z.object({
        name: z.string().optional(),
        object_story_spec: z.record(z.any()),
      }),
    )
    .describe('Creative to use for the ad. Either an existing creative ID or inline creative spec.'),
  status: z
    .enum(['ACTIVE', 'PAUSED'])
    .optional()
    .default('PAUSED')
    .describe('Initial ad status'),
  tracking_specs: z
    .array(z.record(z.any()))
    .optional()
    .describe('Tracking specs for conversion tracking'),
});

const CreateCustomAudienceSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  name: z.string().describe('Name of the custom audience'),
  description: z.string().optional().describe('Description of the custom audience'),
  subtype: z
    .enum([
      'CUSTOM',
      'WEBSITE',
      'APP',
      'OFFLINE_CONVERSION',
      'CLAIM',
      'PARTNER',
      'MANAGED',
      'VIDEO',
      'LOOKALIKE',
      'ENGAGEMENT',
      'BAG_OF_ACCOUNTS',
      'STUDY_RULE_AUDIENCE',
      'FOX',
    ])
    .describe('Subtype of the custom audience'),
  customer_file_source: z
    .enum(['USER_PROVIDED_ONLY', 'PARTNER_PROVIDED_ONLY', 'BOTH_USER_AND_PARTNER_PROVIDED'])
    .optional()
    .describe('Source of the customer data (required for CUSTOM subtype)'),
  rule: z
    .string()
    .optional()
    .describe('Audience rule for WEBSITE or APP subtypes (JSON string)'),
  lookalike_spec: z
    .record(z.any())
    .optional()
    .describe('Lookalike spec for LOOKALIKE subtype'),
});

const UploadAdImageSchema = z.object({
  ad_account_id: z
    .string()
    .describe('Ad account ID (e.g. act_123456789). Include the "act_" prefix.'),
  image_url: z
    .string()
    .optional()
    .describe('URL of the image to upload'),
  filename: z.string().optional().describe('Filename for the image'),
  bytes: z.string().optional().describe('Base64-encoded image bytes'),
});

const ListTargetingSearchSchema = z.object({
  q: z.string().describe('Search query string'),
  type: z
    .enum([
      'adinterest',
      'adTargetingCategory',
      'adeducationschool',
      'adeducationmajor',
      'adworkemployer',
      'adworkposition',
      'adlocale',
      'adgeolocation',
      'adgeolocationmeta',
      'adzipcode',
    ])
    .describe('Type of targeting option to search for'),
  limit: z.number().optional().default(25).describe('Number of results to return'),
});

const ListAdNetworkAnalyticsSchema = z.object({
  business_id: z.string().describe('Meta Business ID'),
  aggregation_period: z
    .enum(['HOUR', 'DAY', 'TOTAL'])
    .optional()
    .default('DAY')
    .describe('Aggregation period for analytics'),
  breakdowns: z
    .array(z.string())
    .optional()
    .describe('Breakdown dimensions (e.g. ["app", "country"])'),
  metrics: z
    .array(z.string())
    .optional()
    .default(['fb_ad_network_imp', 'fb_ad_network_click', 'fb_ad_network_revenue'])
    .describe('Metrics to retrieve'),
  since: z.string().optional().describe('Start date in YYYY-MM-DD format'),
  until: z.string().optional().describe('End date in YYYY-MM-DD format'),
});

const ListAdNetworkAnalyticsResultsSchema = z.object({
  business_id: z.string().describe('Meta Business ID'),
  query_ids: z
    .array(z.string())
    .optional()
    .describe('Query IDs from a previous adnetworkanalytics call'),
  limit: z.number().optional().default(25).describe('Number of results per page'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

// Business-level schemas (shared pagination pattern)
const BusinessIdWithPaginationSchema = z.object({
  business_id: z.string().describe('Meta Business Manager ID'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListAssignedUsersSchema = z.object({
  object_id: z.string().describe('Page ID or Ad Account ID'),
  business_id: z.string().describe('Business ID context for the assignment'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListAssignedPagesSchema = z.object({
  business_user_id: z.string().describe('Business user ID'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
  after: z.string().optional().describe('Pagination cursor for next page'),
});

const ListAgenciesSchema = z.object({
  object_id: z.string().describe('Business ID or Ad Account ID'),
  limit: z.number().optional().default(25).describe('Number of results per page (max 200)'),
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
    {
      name: 'get_user',
      description:
        'Retrieve information about the authenticated Meta user. Returns profile information such as name, email, and other user details.',
      inputSchema: zodToJsonSchema(GetUserSchema),
    },
    {
      name: 'get_meta_object',
      description:
        'Retrieve data for any Meta Marketing API object by its ID. Use for ad accounts, campaigns, ad sets, ads, creatives, pages, or any other Meta object with flexible field selection.',
      inputSchema: zodToJsonSchema(GetMetaObjectSchema),
    },
    {
      name: 'get_page_accounts',
      description:
        'Retrieve permanent page access tokens for pages managed by the authenticated user.',
      inputSchema: zodToJsonSchema(GetPageAccountsSchema),
    },
    {
      name: 'get_video',
      description:
        'Retrieve video information from Meta by video ID, including source URL, permalink, title, description, length, and thumbnails.',
      inputSchema: zodToJsonSchema(GetVideoSchema),
    },
    {
      name: 'create_campaign',
      description:
        'Create a new advertising campaign. Supports various objectives, budgets, and bidding strategies.',
      inputSchema: zodToJsonSchema(CreateCampaignSchema),
    },
    {
      name: 'update_campaign',
      description:
        'Update an existing campaign. Only include fields that need to be changed.',
      inputSchema: zodToJsonSchema(UpdateCampaignSchema),
    },
    {
      name: 'delete_campaign',
      description:
        'Delete a campaign. Marks it as DELETED to stop delivery. The campaign is not permanently removed and can still appear in reports.',
      inputSchema: zodToJsonSchema(DeleteCampaignSchema),
    },
    {
      name: 'create_ad_set',
      description:
        'Create a new ad set within a campaign. Supports detailed targeting, budgets, and optimization goals.',
      inputSchema: zodToJsonSchema(CreateAdSetSchema),
    },
    {
      name: 'create_ad_creative',
      description:
        'Create a new reusable ad creative defining how an ad looks. Supports image, video, and carousel formats.',
      inputSchema: zodToJsonSchema(CreateAdCreativeSchema),
    },
    {
      name: 'get_ad_creative',
      description:
        'Retrieve details for a specific ad creative by its ID.',
      inputSchema: zodToJsonSchema(GetAdCreativeSchema),
    },
    {
      name: 'update_ad_creative',
      description:
        'Update an existing ad creative.',
      inputSchema: zodToJsonSchema(UpdateAdCreativeSchema),
    },
    {
      name: 'delete_ad_creative',
      description:
        'Delete an ad creative by its ID.',
      inputSchema: zodToJsonSchema(DeleteAdCreativeSchema),
    },
    {
      name: 'list_ad_creatives',
      description:
        'List all ad creatives under an ad account.',
      inputSchema: zodToJsonSchema(ListAdCreativesSchema),
    },
    {
      name: 'preview_ad_creative',
      description:
        'Generate a preview of an ad creative in a specified ad format.',
      inputSchema: zodToJsonSchema(PreviewAdCreativeSchema),
    },
    {
      name: 'create_ad',
      description:
        'Create a new ad within an ad set. Supports image, video, carousel, and collection ad formats.',
      inputSchema: zodToJsonSchema(CreateAdSchema),
    },
    {
      name: 'create_custom_audience',
      description:
        'Create a new custom audience. Supports customer lists, website visitors, app users, and lookalike audiences.',
      inputSchema: zodToJsonSchema(CreateCustomAudienceSchema),
    },
    {
      name: 'upload_ad_image',
      description:
        'Upload an image for use in Meta ad creatives. Returns the image hash to reference in creatives.',
      inputSchema: zodToJsonSchema(UploadAdImageSchema),
    },
    {
      name: 'list_targeting_search',
      description:
        'Search for targeting options such as interests, locations, demographics, schools, or employers for ad targeting.',
      inputSchema: zodToJsonSchema(ListTargetingSearchSchema),
    },
    {
      name: 'list_ad_network_analytics',
      description:
        'Retrieve ad network analytics for a Meta Business including revenue and impressions from Facebook Audience Network.',
      inputSchema: zodToJsonSchema(ListAdNetworkAnalyticsSchema),
    },
    {
      name: 'list_ad_network_analytics_results',
      description:
        'Retrieve ad network analytics results for Facebook Audience Network for a specific business.',
      inputSchema: zodToJsonSchema(ListAdNetworkAnalyticsResultsSchema),
    },
    {
      name: 'list_business_ad_accounts',
      description:
        'List all ad accounts owned by a specific Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_client_ad_accounts',
      description:
        'List all client ad accounts accessible to a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_client_ad_accounts',
      description:
        'List pending client ad account access requests for a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_owned_ad_accounts',
      description:
        'List ad accounts with pending ownership status for a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_owned_pages',
      description:
        'List Facebook Pages owned by a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_client_pages',
      description:
        'List client pages associated with a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_client_pages',
      description:
        'List Facebook Pages with pending access requests from the business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_owned_pages',
      description:
        'List Facebook Pages with pending ownership status for a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_owned_apps',
      description:
        'List apps owned by a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_client_apps',
      description:
        'List client apps associated with a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_client_apps',
      description:
        'List apps pending approval or connection to a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_owned_instagram_assets',
      description:
        'List Instagram Business Accounts owned by a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_client_instagram_assets',
      description:
        'List Instagram assets shared with a Meta Business as a client.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_clients',
      description:
        'List client businesses associated with a Meta Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_owned_businesses',
      description:
        'List child businesses owned by a parent Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_system_users',
      description:
        'List system users for a Meta Business Manager account.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_users',
      description:
        'List users with pending invitations to a Business Manager.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_business_invoices',
      description:
        'List business invoices for a Meta Business including amounts, due dates, and payment status.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_initiated_audience_sharing_requests',
      description:
        'List audience sharing requests initiated by a business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_received_audience_sharing_requests',
      description:
        'List audience sharing requests received by a business from other businesses.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_collaborative_ads_collaboration_requests',
      description:
        'List collaborative ads collaboration requests for a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_collaborative_ads_suggested_partners',
      description:
        'List suggested partners for collaborative advertising campaigns.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_owned_offsite_signal_container_business_objects',
      description:
        'List owned offsite signal container business objects for a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_client_offsite_signal_container_business_objects',
      description:
        'List client offsite signal container business objects for a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_pending_shared_offsite_signal_container_business_objects',
      description:
        'List pending shared offsite signal container business objects for a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_managed_partner_ads_funding_source_details',
      description:
        'List managed partner ads funding source details for a Meta Business.',
      inputSchema: zodToJsonSchema(BusinessIdWithPaginationSchema),
    },
    {
      name: 'list_agencies',
      description:
        'List agencies associated with a Meta Business or Ad Account.',
      inputSchema: zodToJsonSchema(ListAgenciesSchema),
    },
    {
      name: 'list_assigned_pages',
      description:
        'List Facebook Pages assigned to a business user.',
      inputSchema: zodToJsonSchema(ListAssignedPagesSchema),
    },
    {
      name: 'list_assigned_users',
      description:
        'List users assigned to a Facebook Page or Ad Account within a business context, including their task permissions.',
      inputSchema: zodToJsonSchema(ListAssignedUsersSchema),
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

  // Helper for business edge requests with pagination
  async function fetchBusinessEdge(
    businessId: string,
    edge: string,
    fields: string,
    limit: number,
    after?: string,
  ) {
    const params: Record<string, any> = { fields, limit };
    if (after) params.after = after;
    const response = await client.get(`/${businessId}/${edge}`, { params });
    return response.data;
  }

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

      case 'get_user': {
        const { fields } = GetUserSchema.parse(args);
        const response = await client.get('/me', { params: { fields: fields.join(',') } });
        const user = response.data;
        const lines = Object.entries(user)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        return { content: [{ type: 'text', text: `User Info:\n\n${lines}` }] };
      }

      case 'get_meta_object': {
        const { object_id, fields } = GetMetaObjectSchema.parse(args);
        const params: Record<string, any> = {};
        if (fields && fields.length > 0) params.fields = fields.join(',');
        const response = await client.get(`/${object_id}`, { params });
        return {
          content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
      }

      case 'get_page_accounts': {
        const { limit, after } = GetPageAccountsSchema.parse(args);
        const params: Record<string, any> = {
          fields: 'id,name,access_token,category,tasks',
          limit,
        };
        if (after) params.after = after;
        const response = await client.get('/me/accounts', { params });
        const pages = response.data.data || [];
        const paging = response.data.paging;

        const formatted = pages
          .map((p: any) => `ID: ${p.id} | Name: ${p.name}\nCategory: ${p.category || 'N/A'} | Tasks: ${(p.tasks || []).join(', ')}`)
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Page Accounts (${pages.length}):\n\n${formatted}${pagination}`
                : 'No page accounts found.',
            },
          ],
        };
      }

      case 'get_video': {
        const { video_id, fields } = GetVideoSchema.parse(args);
        const response = await client.get(`/${video_id}`, {
          params: { fields: fields.join(',') },
        });
        const v = response.data;
        const lines = Object.entries(v)
          .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
          .join('\n');
        return { content: [{ type: 'text', text: `Video ${video_id}:\n\n${lines}` }] };
      }

      case 'create_campaign': {
        const {
          ad_account_id,
          name,
          objective,
          status,
          special_ad_categories,
          daily_budget,
          lifetime_budget,
          bid_strategy,
        } = CreateCampaignSchema.parse(args);

        const payload: Record<string, any> = {
          name,
          objective,
          status,
          special_ad_categories,
        };
        if (daily_budget) payload.daily_budget = daily_budget;
        if (lifetime_budget) payload.lifetime_budget = lifetime_budget;
        if (bid_strategy) payload.bid_strategy = bid_strategy;

        const response = await client.post(`/${ad_account_id}/campaigns`, payload);
        return {
          content: [
            {
              type: 'text',
              text: `Campaign created successfully.\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'update_campaign': {
        const { campaign_id, ...rest } = UpdateCampaignSchema.parse(args);
        const payload: Record<string, any> = {};
        if (rest.name !== undefined) payload.name = rest.name;
        if (rest.status !== undefined) payload.status = rest.status;
        if (rest.daily_budget !== undefined) payload.daily_budget = rest.daily_budget;
        if (rest.lifetime_budget !== undefined) payload.lifetime_budget = rest.lifetime_budget;
        if (rest.bid_strategy !== undefined) payload.bid_strategy = rest.bid_strategy;

        await client.post(`/${campaign_id}`, payload);
        return {
          content: [{ type: 'text', text: `Campaign ${campaign_id} updated successfully.` }],
        };
      }

      case 'delete_campaign': {
        const { campaign_id } = DeleteCampaignSchema.parse(args);
        await client.delete(`/${campaign_id}`);
        return {
          content: [
            {
              type: 'text',
              text: `Campaign ${campaign_id} deleted (marked as DELETED). It will no longer deliver ads.`,
            },
          ],
        };
      }

      case 'create_ad_set': {
        const {
          ad_account_id,
          campaign_id,
          name,
          optimization_goal,
          billing_event,
          bid_amount,
          daily_budget,
          lifetime_budget,
          start_time,
          end_time,
          status,
          targeting,
        } = CreateAdSetSchema.parse(args);

        const payload: Record<string, any> = {
          campaign_id,
          name,
          optimization_goal,
          billing_event,
          status,
        };
        if (bid_amount !== undefined) payload.bid_amount = bid_amount;
        if (daily_budget !== undefined) payload.daily_budget = daily_budget;
        if (lifetime_budget !== undefined) payload.lifetime_budget = lifetime_budget;
        if (start_time) payload.start_time = start_time;
        if (end_time) payload.end_time = end_time;
        if (targeting) payload.targeting = JSON.stringify(targeting);

        const response = await client.post(`/${ad_account_id}/adsets`, payload);
        return {
          content: [
            {
              type: 'text',
              text: `Ad set created successfully.\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'create_ad_creative': {
        const {
          ad_account_id,
          name,
          object_story_spec,
          asset_feed_spec,
          image_hash,
          image_url,
          video_id,
          title,
          body,
          link_url,
          call_to_action_type,
        } = CreateAdCreativeSchema.parse(args);

        const payload: Record<string, any> = { name };
        if (object_story_spec) payload.object_story_spec = JSON.stringify(object_story_spec);
        if (asset_feed_spec) payload.asset_feed_spec = JSON.stringify(asset_feed_spec);
        if (image_hash) payload.image_hash = image_hash;
        if (image_url) payload.image_url = image_url;
        if (video_id) payload.video_id = video_id;
        if (title) payload.title = title;
        if (body) payload.body = body;
        if (link_url) payload.link_url = link_url;
        if (call_to_action_type) payload.call_to_action_type = call_to_action_type;

        const response = await client.post(`/${ad_account_id}/adcreatives`, payload);
        return {
          content: [
            {
              type: 'text',
              text: `Ad creative created successfully.\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'get_ad_creative': {
        const { creative_id, fields } = GetAdCreativeSchema.parse(args);
        const response = await client.get(`/${creative_id}`, {
          params: { fields: fields.join(',') },
        });
        const c = response.data;
        const lines = Object.entries(c)
          .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
          .join('\n');
        return { content: [{ type: 'text', text: `Ad Creative ${creative_id}:\n\n${lines}` }] };
      }

      case 'update_ad_creative': {
        const { creative_id, ...rest } = UpdateAdCreativeSchema.parse(args);
        const payload: Record<string, any> = {};
        if (rest.name !== undefined) payload.name = rest.name;
        if (rest.object_story_spec !== undefined) payload.object_story_spec = JSON.stringify(rest.object_story_spec);
        if (rest.asset_feed_spec !== undefined) payload.asset_feed_spec = JSON.stringify(rest.asset_feed_spec);
        if (rest.title !== undefined) payload.title = rest.title;
        if (rest.body !== undefined) payload.body = rest.body;

        await client.post(`/${creative_id}`, payload);
        return {
          content: [{ type: 'text', text: `Ad creative ${creative_id} updated successfully.` }],
        };
      }

      case 'delete_ad_creative': {
        const { creative_id } = DeleteAdCreativeSchema.parse(args);
        await client.delete(`/${creative_id}`);
        return {
          content: [{ type: 'text', text: `Ad creative ${creative_id} deleted successfully.` }],
        };
      }

      case 'list_ad_creatives': {
        const { ad_account_id, fields, limit, after } = ListAdCreativesSchema.parse(args);
        const params: Record<string, any> = { fields: fields.join(','), limit };
        if (after) params.after = after;

        const response = await client.get(`/${ad_account_id}/adcreatives`, { params });
        const creatives = response.data.data || [];
        const paging = response.data.paging;

        const formatted = creatives
          .map((c: any) => {
            const lines = [`ID: ${c.id} | Name: ${c.name}`];
            if (c.status) lines.push(`Status: ${c.status}`);
            if (c.effective_object_story_id) lines.push(`Story: ${c.effective_object_story_id}`);
            return lines.join('\n');
          })
          .join('\n\n');

        const nextCursor = paging?.cursors?.after;
        const pagination = nextCursor ? `\n\nNext page cursor: ${nextCursor}` : '';

        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Ad Creatives for ${ad_account_id} (${creatives.length}):\n\n${formatted}${pagination}`
                : `No ad creatives found for ${ad_account_id}.`,
            },
          ],
        };
      }

      case 'preview_ad_creative': {
        const { creative_id, ad_format } = PreviewAdCreativeSchema.parse(args);
        const response = await client.get(`/${creative_id}/previews`, {
          params: { ad_format },
        });
        const previews = response.data.data || [];
        const formatted = previews
          .map((p: any) => `Format: ${p.ad_format || ad_format}\nBody:\n${p.body}`)
          .join('\n\n---\n\n');
        return {
          content: [
            {
              type: 'text',
              text: formatted || `No preview available for creative ${creative_id}.`,
            },
          ],
        };
      }

      case 'create_ad': {
        const { ad_account_id, name, adset_id, creative, status, tracking_specs } =
          CreateAdSchema.parse(args);

        const payload: Record<string, any> = {
          name,
          adset_id,
          status,
          creative: JSON.stringify(creative),
        };
        if (tracking_specs) payload.tracking_specs = JSON.stringify(tracking_specs);

        const response = await client.post(`/${ad_account_id}/ads`, payload);
        return {
          content: [
            {
              type: 'text',
              text: `Ad created successfully.\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'create_custom_audience': {
        const {
          ad_account_id,
          name,
          description,
          subtype,
          customer_file_source,
          rule,
          lookalike_spec,
        } = CreateCustomAudienceSchema.parse(args);

        const payload: Record<string, any> = { name, subtype };
        if (description) payload.description = description;
        if (customer_file_source) payload.customer_file_source = customer_file_source;
        if (rule) payload.rule = rule;
        if (lookalike_spec) payload.lookalike_spec = JSON.stringify(lookalike_spec);

        const response = await client.post(`/${ad_account_id}/customaudiences`, payload);
        return {
          content: [
            {
              type: 'text',
              text: `Custom audience created successfully.\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'upload_ad_image': {
        const { ad_account_id, image_url, filename, bytes } = UploadAdImageSchema.parse(args);
        const payload: Record<string, any> = {};
        if (image_url) payload.url = image_url;
        if (filename) payload.filename = filename;
        if (bytes) payload.bytes = bytes;

        const response = await client.post(`/${ad_account_id}/adimages`, payload);
        const images = response.data.images || {};
        const imageEntries = Object.entries(images);
        const formatted = imageEntries
          .map(([fname, img]: [string, any]) => `Filename: ${fname}\nHash: ${img.hash}\nURL: ${img.url || 'N/A'}`)
          .join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Image uploaded successfully:\n\n${formatted}`
                : `Image uploaded: ${JSON.stringify(response.data)}`,
            },
          ],
        };
      }

      case 'list_targeting_search': {
        const { q, type, limit } = ListTargetingSearchSchema.parse(args);
        const response = await client.get('/search', {
          params: { q, type, limit },
        });
        const results = response.data.data || [];
        const formatted = results
          .map((r: any) => {
            const parts = [`Name: ${r.name}`];
            if (r.id) parts.push(`ID: ${r.id}`);
            if (r.audience_size_lower_bound) parts.push(`Audience: ${r.audience_size_lower_bound.toLocaleString()} - ${r.audience_size_upper_bound?.toLocaleString()}`);
            if (r.type) parts.push(`Type: ${r.type}`);
            if (r.country_code) parts.push(`Country: ${r.country_code}`);
            return parts.join(' | ');
          })
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: formatted
                ? `Targeting results for "${q}" (${results.length}):\n\n${formatted}`
                : `No targeting options found for "${q}".`,
            },
          ],
        };
      }

      case 'list_ad_network_analytics': {
        const { business_id, aggregation_period, breakdowns, metrics, since, until } =
          ListAdNetworkAnalyticsSchema.parse(args);
        const params: Record<string, any> = {
          aggregation_period,
          metrics: JSON.stringify(metrics),
        };
        if (breakdowns && breakdowns.length > 0) params.breakdowns = JSON.stringify(breakdowns);
        if (since) params.since = since;
        if (until) params.until = until;

        const response = await client.get(`/${business_id}/adnetworkanalytics`, { params });
        return {
          content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
      }

      case 'list_ad_network_analytics_results': {
        const { business_id, query_ids, limit, after } =
          ListAdNetworkAnalyticsResultsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (query_ids && query_ids.length > 0) params.query_ids = JSON.stringify(query_ids);
        if (after) params.after = after;

        const response = await client.get(`/${business_id}/adnetworkanalytics_results`, { params });
        return {
          content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
      }

      // ---- Business edge tools (shared pattern) ----

      case 'list_business_ad_accounts': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'owned_ad_accounts',
          'id,name,currency,timezone_name,account_status',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_client_ad_accounts': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'client_ad_accounts',
          'id,name,currency,account_status',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_client_ad_accounts': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'pending_client_ad_accounts',
          'id,name,account_status',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_owned_ad_accounts': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'pending_owned_ad_accounts',
          'id,name,account_status',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_owned_pages': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'owned_pages', 'id,name,category', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_client_pages': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'client_pages', 'id,name,category', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_client_pages': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'pending_client_pages', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_owned_pages': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'pending_owned_pages', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_owned_apps': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'owned_apps', 'id,name,category', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_client_apps': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'client_apps', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_client_apps': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'pending_client_apps', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_owned_instagram_assets': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'owned_instagram_accounts',
          'id,name,username,profile_pic',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_client_instagram_assets': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'client_instagram_accounts',
          'id,name,username',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_clients': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'clients', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_owned_businesses': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'owned_businesses', 'id,name', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_system_users': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'system_users', 'id,name,role', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_users': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(business_id, 'pending_users', 'id,name,email,role', limit, after);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_business_invoices': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'business_invoices',
          'id,invoice_date,due_date,payment_status,amount,currency',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_initiated_audience_sharing_requests': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'initiated_audience_sharing_requests',
          'id,status,recipient_id,audience_id',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_received_audience_sharing_requests': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'received_audience_sharing_requests',
          'id,status,initiator_id,audience_id',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_collaborative_ads_collaboration_requests': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'collaborative_ads_collaboration_requests',
          'id,status,requester_agency_or_brand,contact_email',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_collaborative_ads_suggested_partners': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'collaborative_ads_suggested_partners',
          'id,name',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_owned_offsite_signal_container_business_objects': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'owned_offsite_signal_container_business_objects',
          'id,name',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_client_offsite_signal_container_business_objects': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'client_offsite_signal_container_business_objects',
          'id,name',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_pending_shared_offsite_signal_container_business_objects': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'pending_shared_offsite_signal_container_business_objects',
          'id,name',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_managed_partner_ads_funding_source_details': {
        const { business_id, limit, after } = BusinessIdWithPaginationSchema.parse(args);
        const data = await fetchBusinessEdge(
          business_id,
          'managed_partner_ads_funding_source_details',
          'id,name',
          limit,
          after,
        );
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'list_agencies': {
        const { object_id, limit, after } = ListAgenciesSchema.parse(args);
        const params: Record<string, any> = { fields: 'id,name', limit };
        if (after) params.after = after;
        const response = await client.get(`/${object_id}/agencies`, { params });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'list_assigned_pages': {
        const { business_user_id, limit, after } = ListAssignedPagesSchema.parse(args);
        const params: Record<string, any> = { fields: 'id,name,tasks', limit };
        if (after) params.after = after;
        const response = await client.get(`/${business_user_id}/assigned_pages`, { params });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      }

      case 'list_assigned_users': {
        const { object_id, business_id, limit, after } = ListAssignedUsersSchema.parse(args);
        const params: Record<string, any> = {
          fields: 'id,name,tasks',
          business: business_id,
          limit,
        };
        if (after) params.after = after;
        const response = await client.get(`/${object_id}/assigned_users`, { params });
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
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
