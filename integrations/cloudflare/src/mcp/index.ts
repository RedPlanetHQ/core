import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getCloudflareClient, CloudflareConfig } from '../utils';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ListZonesSchema = z.object({
  name: z.string().optional().describe('Filter by exact zone name (domain, e.g. "example.com")'),
  status: z
    .enum(['active', 'pending', 'initializing', 'moved', 'deleted', 'deactivated'])
    .optional()
    .describe('Filter zones by status'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe('Results per page, max 50 (default: 20)'),
});

const GetZoneSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID'),
});

const CreateZoneSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  name: z.string().describe('The domain name to add as a zone (e.g. "example.com")'),
  jump_start: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Automatically attempt to fetch existing DNS records for the domain. Default: true.'
    ),
});

const UpdateZoneSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID'),
  paused: z
    .boolean()
    .optional()
    .describe('Pause Cloudflare on the zone (traffic bypasses Cloudflare)'),
  vanity_name_servers: z
    .array(z.string())
    .optional()
    .describe('Custom vanity name servers for the zone (Enterprise only)'),
  plan_id: z
    .string()
    .optional()
    .describe('Plan ID to switch the zone to (use exact plan ID from Cloudflare)'),
});

const DeleteZoneSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID to permanently delete'),
});

const UpdateZoneSettingsSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID'),
  ssl: z
    .enum(['off', 'flexible', 'full', 'strict'])
    .optional()
    .describe('SSL mode: off, flexible (encrypts visitor↔CF), full (encrypts both hops), strict (full + valid cert required)'),
  always_use_https: z
    .enum(['on', 'off'])
    .optional()
    .describe('Redirect all HTTP requests to HTTPS'),
  min_tls_version: z
    .enum(['1.0', '1.1', '1.2', '1.3'])
    .optional()
    .describe('Minimum TLS version to accept'),
  security_level: z
    .enum(['essentially_off', 'low', 'medium', 'high', 'under_attack'])
    .optional()
    .describe('Security level for challenge pages (I\'m Under Attack mode = under_attack)'),
  cache_level: z
    .enum(['aggressive', 'basic', 'simplified'])
    .optional()
    .describe('Caching aggressiveness: aggressive (all static assets), basic (standard), simplified (ignores query strings)'),
  browser_cache_ttl: z
    .number()
    .int()
    .optional()
    .describe('Browser cache TTL in seconds. 0 means Cloudflare respects origin Cache-Control headers.'),
  development_mode: z
    .enum(['on', 'off'])
    .optional()
    .describe('Development mode: bypass cache for 3 hours to see changes immediately'),
});

const ListDnsRecordsSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID to list DNS records for'),
  type: z
    .enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])
    .optional()
    .describe('Filter by DNS record type'),
  name: z.string().optional().describe('Filter by record name (e.g. "sub.example.com")'),
  content: z.string().optional().describe('Filter by record content/value'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Results per page, max 100 (default: 20)'),
});

const CreateDnsRecordSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID to add the DNS record to'),
  type: z
    .enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])
    .describe('DNS record type'),
  name: z
    .string()
    .describe(
      'DNS record name. Use "@" for the zone apex. Relative names are accepted (e.g. "sub" for "sub.example.com").'
    ),
  content: z
    .string()
    .describe('DNS record content/value (e.g. IP address for A records, target for CNAME)'),
  ttl: z
    .number()
    .int()
    .min(60)
    .max(86400)
    .optional()
    .describe('TTL in seconds. Use 1 for automatic TTL (Cloudflare default). Min 60, max 86400.'),
  proxied: z
    .boolean()
    .optional()
    .describe(
      'Whether to proxy traffic through Cloudflare (orange cloud). Only valid for A/AAAA/CNAME records.'
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .max(65535)
    .optional()
    .describe('MX record priority (required for MX records)'),
  comment: z.string().optional().describe('Optional human-readable comment for this record'),
});

const UpdateDnsRecordSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID'),
  dns_record_id: z.string().describe('ID of the DNS record to overwrite'),
  type: z
    .enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])
    .describe('DNS record type (required for overwrite)'),
  name: z.string().describe('DNS record name (required for overwrite)'),
  content: z.string().describe('DNS record content/value (required for overwrite)'),
  ttl: z
    .number()
    .int()
    .min(60)
    .max(86400)
    .optional()
    .describe('TTL in seconds. Use 1 for automatic.'),
  proxied: z.boolean().optional().describe('Whether to enable Cloudflare proxy'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(65535)
    .optional()
    .describe('MX record priority'),
  comment: z.string().optional().describe('Human-readable comment for this record'),
});

const DeleteDnsRecordSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID'),
  dns_record_id: z.string().describe('ID of the DNS record to delete'),
});

const ListAccountsSchema = z.object({
  name: z.string().optional().describe('Filter accounts by name (partial match)'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe('Results per page, max 50 (default: 20)'),
});

const ListAccountMembersSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  status: z
    .enum(['accepted', 'pending', 'rejected'])
    .optional()
    .describe('Filter members by membership status'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(20)
    .describe('Results per page, max 50 (default: 20)'),
});

const GetListsSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Results per page, max 100 (default: 20)'),
});

const CreateListSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  kind: z
    .enum(['ip', 'redirect', 'hostname', 'asn'])
    .describe('Type of list: ip (IP addresses), redirect (URL redirects), hostname, or asn'),
  name: z
    .string()
    .describe('Name for the list (lowercase letters, numbers, underscores; max 50 chars)'),
  description: z.string().optional().describe('Optional description for the list'),
});

const UpdateListSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID'),
  list_id: z.string().describe('ID of the list to update'),
  description: z.string().describe('New description for the list'),
});

const DeleteListSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID'),
  list_id: z.string().describe('ID of the WAF list to delete'),
});

const ListFirewallRulesSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID to list firewall rules for'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Results per page, max 100 (default: 20)'),
});

const GetBotManagementSchema = z.object({
  zone_id: z.string().describe('Cloudflare zone ID to retrieve Bot Management settings for'),
});

const ListMonitorsSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Results per page, max 100 (default: 20)'),
});

const ListPoolsSchema = z.object({
  account_id: z.string().describe('Cloudflare account ID (obtain via cloudflare_list_accounts)'),
  page: z.number().int().min(1).optional().default(1).describe('Page number (default: 1)'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Results per page, max 100 (default: 20)'),
});

// Pre-convert schemas to avoid deep TS instantiation
const listZonesSchemaJson = zodToJsonSchema(ListZonesSchema) as any;
const getZoneSchemaJson = zodToJsonSchema(GetZoneSchema) as any;
const createZoneSchemaJson = zodToJsonSchema(CreateZoneSchema) as any;
const updateZoneSchemaJson = zodToJsonSchema(UpdateZoneSchema) as any;
const deleteZoneSchemaJson = zodToJsonSchema(DeleteZoneSchema) as any;
const updateZoneSettingsSchemaJson = zodToJsonSchema(UpdateZoneSettingsSchema) as any;
const listDnsRecordsSchemaJson = zodToJsonSchema(ListDnsRecordsSchema) as any;
const createDnsRecordSchemaJson = zodToJsonSchema(CreateDnsRecordSchema) as any;
const updateDnsRecordSchemaJson = zodToJsonSchema(UpdateDnsRecordSchema) as any;
const deleteDnsRecordSchemaJson = zodToJsonSchema(DeleteDnsRecordSchema) as any;
const listAccountsSchemaJson = zodToJsonSchema(ListAccountsSchema) as any;
const listAccountMembersSchemaJson = zodToJsonSchema(ListAccountMembersSchema) as any;
const getListsSchemaJson = zodToJsonSchema(GetListsSchema) as any;
const createListSchemaJson = zodToJsonSchema(CreateListSchema) as any;
const updateListSchemaJson = zodToJsonSchema(UpdateListSchema) as any;
const deleteListSchemaJson = zodToJsonSchema(DeleteListSchema) as any;
const listFirewallRulesSchemaJson = zodToJsonSchema(ListFirewallRulesSchema) as any;
const getBotManagementSchemaJson = zodToJsonSchema(GetBotManagementSchema) as any;
const listMonitorsSchemaJson = zodToJsonSchema(ListMonitorsSchema) as any;
const listPoolsSchemaJson = zodToJsonSchema(ListPoolsSchema) as any;

// ─── Tool list ────────────────────────────────────────────────────────────────

export function getTools() {
  return [
    // ── Accounts ──────────────────────────────────────────────────────────────
    {
      name: 'cloudflare_list_accounts',
      description:
        'List all Cloudflare accounts you have access to. Returns account IDs, names, types, and settings. Use this first to discover account IDs needed by other account-scoped tools.',
      inputSchema: listAccountsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_list_account_members',
      description:
        'List all members of a Cloudflare account with their roles, permissions, and membership status. Useful for auditing who has access to an account.',
      inputSchema: listAccountMembersSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // ── Zones ─────────────────────────────────────────────────────────────────
    {
      name: 'cloudflare_list_zones',
      description:
        'List Cloudflare zones (domains) accessible with the configured API token. Supports filtering by name and status with explicit pagination.',
      inputSchema: listZonesSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_get_zone',
      description:
        'Get detailed metadata for a specific Cloudflare zone by its ID, including plan, status, name servers, and settings.',
      inputSchema: getZoneSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_create_zone',
      description:
        'Create a new DNS zone (domain) in Cloudflare under the given account. The zone will be in "pending" status until nameservers are updated at the domain registrar. Requires the account ID (obtainable via cloudflare_list_accounts).',
      inputSchema: createZoneSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cloudflare_update_zone',
      description:
        'Update properties of an existing Cloudflare zone such as paused state, vanity name servers, or plan. Changes apply immediately. Confirm zone ID before calling.',
      inputSchema: updateZoneSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_delete_zone',
      description:
        'Permanently delete a Cloudflare zone and all its DNS records. This action is irreversible. Confirm the zone ID before calling.',
      inputSchema: deleteZoneSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'cloudflare_update_zone_settings',
      description:
        'Update zone-level settings for a Cloudflare zone. Supports SSL mode, HTTPS redirect, TLS version, security level, cache level, browser cache TTL, and development mode. Only the settings provided will be changed.',
      inputSchema: updateZoneSettingsSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // ── DNS Records ───────────────────────────────────────────────────────────
    {
      name: 'cloudflare_list_dns_records',
      description:
        'List DNS records for a Cloudflare zone. Filter by record type, name, or content. Returns paginated results with total count.',
      inputSchema: listDnsRecordsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_create_dns_record',
      description:
        'Create a new DNS record in a Cloudflare zone. Supports A, AAAA, CNAME, TXT, MX, NS, SRV, CAA, and PTR record types.',
      inputSchema: createDnsRecordSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cloudflare_update_dns_record',
      description:
        'Overwrite (replace) an existing DNS record in a Cloudflare zone using PUT semantics. All record fields are replaced — type, name, and content are required.',
      inputSchema: updateDnsRecordSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_delete_dns_record',
      description: 'Permanently delete a DNS record from a Cloudflare zone by its ID.',
      inputSchema: deleteDnsRecordSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // ── WAF Lists ─────────────────────────────────────────────────────────────
    {
      name: 'cloudflare_get_lists',
      description:
        'Fetch all WAF custom lists for an account (without items). Lists can contain IPs, hostnames, ASNs, or redirects used in firewall rules. Paginate using page/per_page and check result_info.total_pages.',
      inputSchema: getListsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_create_list',
      description:
        'Create a new empty WAF custom list for use in firewall rules. Supports ip, redirect, hostname, and asn kinds. Note: Free plans allow 1 list, Pro/Business 10, Enterprise 1000. Add items to the list separately after creation.',
      inputSchema: createListSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cloudflare_update_list',
      description:
        'Update the description of a WAF custom list. Only the description can be changed via this tool; to modify list items use separate item management actions.',
      inputSchema: updateListSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_delete_list',
      description:
        'Permanently delete a WAF custom list from an account. Ensure no active firewall rules reference the list before deleting, as deletion is irreversible.',
      inputSchema: deleteListSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // ── Firewall ──────────────────────────────────────────────────────────────
    {
      name: 'cloudflare_list_firewall_rules',
      description:
        'List firewall rules for a specific Cloudflare zone. Returns rule IDs, expressions, actions, and descriptions. Use to audit current firewall configuration for a zone.',
      inputSchema: listFirewallRulesSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_get_bot_management_settings',
      description:
        'Retrieve the Bot Management configuration for a Cloudflare zone, including Bot Fight Mode, Super Bot Fight Mode, or Enterprise Bot Management settings.',
      inputSchema: getBotManagementSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // ── Load Balancing ────────────────────────────────────────────────────────
    {
      name: 'cloudflare_list_monitors',
      description:
        'List all load balancer monitors in a Cloudflare account. Returns monitor configurations including health check settings. Paginate using page/per_page; check result_info.total_pages for additional pages.',
      inputSchema: listMonitorsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'cloudflare_list_pools',
      description:
        'List all load balancer pools in a Cloudflare account. Returns pool configurations including origins and health status. Paginate using page/per_page; check result_info.total_pages for additional pages.',
      inputSchema: listPoolsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool runner ─────────────────────────────────────────────────────────────

// Cloudflare zone settings are patched one at a time via /zones/:id/settings/:setting_name
const ZONE_SETTINGS_MAP: Record<string, string> = {
  ssl: 'ssl',
  always_use_https: 'always_use_https',
  min_tls_version: 'min_tls_version',
  security_level: 'security_level',
  cache_level: 'cache_level',
  browser_cache_ttl: 'browser_cache_ttl',
  development_mode: 'development_mode',
};

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: CloudflareConfig
): Promise<any> {
  const client = getCloudflareClient(config.api_token);

  const ok = (data: any) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });

  const err = (msg: string) => ({
    content: [{ type: 'text', text: `Error: ${msg}` }],
    isError: true,
  });

  try {
    switch (name) {
      // ── Accounts ────────────────────────────────────────────────────────────
      case 'cloudflare_list_accounts': {
        const { name: accountName, page, per_page } = ListAccountsSchema.parse(args);
        const params: Record<string, any> = { page, per_page };
        if (accountName) params.name = accountName;

        const response = await client.get('/accounts', { params });
        return ok(response.data);
      }

      case 'cloudflare_list_account_members': {
        const { account_id, status, page, per_page } = ListAccountMembersSchema.parse(args);
        const params: Record<string, any> = { page, per_page };
        if (status) params.status = status;

        const response = await client.get(`/accounts/${account_id}/members`, { params });
        return ok(response.data);
      }

      // ── Zones ────────────────────────────────────────────────────────────────
      case 'cloudflare_list_zones': {
        const { name: zoneName, status, page, per_page } = ListZonesSchema.parse(args);
        const params: Record<string, any> = { page, per_page };
        if (zoneName) params.name = zoneName;
        if (status) params.status = status;

        const response = await client.get('/zones', { params });
        return ok(response.data);
      }

      case 'cloudflare_get_zone': {
        const { zone_id } = GetZoneSchema.parse(args);
        const response = await client.get(`/zones/${zone_id}`);
        return ok(response.data?.result);
      }

      case 'cloudflare_create_zone': {
        const { account_id, name: zoneName, jump_start } = CreateZoneSchema.parse(args);
        const response = await client.post('/zones', {
          account: { id: account_id },
          name: zoneName,
          jump_start,
        });
        return ok(response.data?.result);
      }

      case 'cloudflare_update_zone': {
        const { zone_id, paused, vanity_name_servers, plan_id } = UpdateZoneSchema.parse(args);
        const body: Record<string, any> = {};
        if (paused !== undefined) body.paused = paused;
        if (vanity_name_servers !== undefined) body.vanity_name_servers = vanity_name_servers;
        if (plan_id !== undefined) body.plan = { id: plan_id };

        if (Object.keys(body).length === 0) {
          return err('No fields provided to update');
        }

        const response = await client.patch(`/zones/${zone_id}`, body);
        return ok(response.data?.result);
      }

      case 'cloudflare_delete_zone': {
        const { zone_id } = DeleteZoneSchema.parse(args);
        const response = await client.delete(`/zones/${zone_id}`);
        return ok(response.data?.result);
      }

      case 'cloudflare_update_zone_settings': {
        const { zone_id, ...settings } = UpdateZoneSettingsSchema.parse(args);
        const settingEntries = Object.entries(settings).filter(
          ([key, value]) => value !== undefined && key in ZONE_SETTINGS_MAP
        );

        if (settingEntries.length === 0) {
          return err('No settings provided to update');
        }

        // Cloudflare requires one API call per setting
        const results: Record<string, any> = {};
        for (const [key, value] of settingEntries) {
          const settingName = ZONE_SETTINGS_MAP[key];
          const response = await client.patch(`/zones/${zone_id}/settings/${settingName}`, {
            value,
          });
          results[key] = response.data?.result;
        }

        return ok({ zone_id, updated: results });
      }

      // ── DNS Records ──────────────────────────────────────────────────────────
      case 'cloudflare_list_dns_records': {
        const { zone_id, type, name: recordName, content, page, per_page } =
          ListDnsRecordsSchema.parse(args);
        const params: Record<string, any> = { page, per_page };
        if (type) params.type = type;
        if (recordName) params.name = recordName;
        if (content) params.content = content;

        const response = await client.get(`/zones/${zone_id}/dns_records`, { params });
        return ok(response.data);
      }

      case 'cloudflare_create_dns_record': {
        const { zone_id, type, name: recordName, content, ttl, proxied, priority, comment } =
          CreateDnsRecordSchema.parse(args);
        const body: Record<string, any> = { type, name: recordName, content };
        if (ttl !== undefined) body.ttl = ttl;
        if (proxied !== undefined) body.proxied = proxied;
        if (priority !== undefined) body.priority = priority;
        if (comment) body.comment = comment;

        const response = await client.post(`/zones/${zone_id}/dns_records`, body);
        return ok(response.data?.result);
      }

      case 'cloudflare_update_dns_record': {
        // PUT = full overwrite; all required fields must be present
        const { zone_id, dns_record_id, type, name: recordName, content, ttl, proxied, priority, comment } =
          UpdateDnsRecordSchema.parse(args);
        const body: Record<string, any> = { type, name: recordName, content };
        if (ttl !== undefined) body.ttl = ttl;
        if (proxied !== undefined) body.proxied = proxied;
        if (priority !== undefined) body.priority = priority;
        if (comment) body.comment = comment;

        const response = await client.put(`/zones/${zone_id}/dns_records/${dns_record_id}`, body);
        return ok(response.data?.result);
      }

      case 'cloudflare_delete_dns_record': {
        const { zone_id, dns_record_id } = DeleteDnsRecordSchema.parse(args);
        const response = await client.delete(`/zones/${zone_id}/dns_records/${dns_record_id}`);
        return ok(response.data?.result);
      }

      // ── WAF Lists ────────────────────────────────────────────────────────────
      case 'cloudflare_get_lists': {
        const { account_id, page, per_page } = GetListsSchema.parse(args);
        const response = await client.get(`/accounts/${account_id}/rules/lists`, {
          params: { page, per_page },
        });
        return ok(response.data);
      }

      case 'cloudflare_create_list': {
        const { account_id, kind, name: listName, description } = CreateListSchema.parse(args);
        const body: Record<string, any> = { kind, name: listName };
        if (description) body.description = description;

        const response = await client.post(`/accounts/${account_id}/rules/lists`, body);
        return ok(response.data?.result);
      }

      case 'cloudflare_update_list': {
        const { account_id, list_id, description } = UpdateListSchema.parse(args);
        const response = await client.put(`/accounts/${account_id}/rules/lists/${list_id}`, {
          description,
        });
        return ok(response.data?.result);
      }

      case 'cloudflare_delete_list': {
        const { account_id, list_id } = DeleteListSchema.parse(args);
        const response = await client.delete(`/accounts/${account_id}/rules/lists/${list_id}`);
        return ok(response.data?.result);
      }

      // ── Firewall ─────────────────────────────────────────────────────────────
      case 'cloudflare_list_firewall_rules': {
        const { zone_id, page, per_page } = ListFirewallRulesSchema.parse(args);
        const response = await client.get(`/zones/${zone_id}/firewall/rules`, {
          params: { page, per_page },
        });
        return ok(response.data);
      }

      case 'cloudflare_get_bot_management_settings': {
        const { zone_id } = GetBotManagementSchema.parse(args);
        const response = await client.get(`/zones/${zone_id}/bot_management`);
        return ok(response.data?.result);
      }

      // ── Load Balancing ───────────────────────────────────────────────────────
      case 'cloudflare_list_monitors': {
        const { account_id, page, per_page } = ListMonitorsSchema.parse(args);
        const response = await client.get(`/accounts/${account_id}/load_balancers/monitors`, {
          params: { page, per_page },
        });
        return ok(response.data);
      }

      case 'cloudflare_list_pools': {
        const { account_id, page, per_page } = ListPoolsSchema.parse(args);
        const response = await client.get(`/accounts/${account_id}/load_balancers/pools`, {
          params: { page, per_page },
        });
        return ok(response.data);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const cfErrors = error.response?.data?.errors;
    const message =
      cfErrors?.map((e: any) => e.message).join('; ') ??
      error.response?.data?.message ??
      error.message;
    return err(message);
  }
}
