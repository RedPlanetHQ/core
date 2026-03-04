import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  getContacts,
  createContact,
  addTagToContact,
  getSales,
  getFunnels,
  getCourses,
  grantCourseAccess,
  listServers,
  createServer,
  getServer,
  deleteServer,
  listServerTypes,
  provisionCustomerServer,
  generateCloudInitScript,
} from '../utils';

// ============================================================================
// TOOL SCHEMAS
// ============================================================================

const ListContactsSchema = z.object({
  page: z.number().optional().default(1).describe('Page number'),
  limit: z.number().optional().default(20).describe('Items per page'),
});

const CreateContactSchema = z.object({
  email: z.string().email().describe('Contact email address'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  tags: z.array(z.string()).optional().describe('Tags to apply'),
});

const TagContactSchema = z.object({
  contactId: z.string().describe('Systeme.io contact ID'),
  tagName: z.string().describe('Tag name to add'),
});

const ListSalesSchema = z.object({
  page: z.number().optional().default(1).describe('Page number'),
});

const ListFunnelsSchema = z.object({
  page: z.number().optional().default(1).describe('Page number'),
});

const ListServersSchema = z.object({});

const GetServerSchema = z.object({
  serverId: z.string().describe('Hetzner server ID'),
});

const ProvisionServerSchema = z.object({
  customerEmail: z.string().email().describe('Customer email for the new server'),
  customerName: z.string().describe('Customer name'),
  serverType: z.string().optional().default('cpx31').describe('Hetzner server type (e.g., cpx31, cpx41)'),
  location: z.string().optional().default('nbg1').describe('Hetzner datacenter (nbg1, fsn1, hel1)'),
});

const DeleteServerSchema = z.object({
  serverId: z.string().describe('Hetzner server ID to delete'),
});

const GrantCourseAccessSchema = z.object({
  courseId: z.string().describe('Systeme.io course ID'),
  studentEmail: z.string().email().describe('Student email to grant access'),
});

const GetRevenueReportSchema = z.object({});

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export async function getTools() {
  return [
    {
      type: 'tools',
      data: [
        // --- SYSTEME.IO TOOLS ---
        {
          name: 'list_contacts',
          description: 'Liste alle Kontakte/Leads aus Systeme.io auf',
          inputSchema: zodToJsonSchema(ListContactsSchema),
        },
        {
          name: 'create_contact',
          description: 'Erstelle einen neuen Kontakt/Lead in Systeme.io',
          inputSchema: zodToJsonSchema(CreateContactSchema),
        },
        {
          name: 'tag_contact',
          description: 'Füge einem Kontakt in Systeme.io einen Tag hinzu',
          inputSchema: zodToJsonSchema(TagContactSchema),
        },
        {
          name: 'list_sales',
          description: 'Liste alle Verkäufe/Bestellungen aus Systeme.io auf',
          inputSchema: zodToJsonSchema(ListSalesSchema),
        },
        {
          name: 'list_funnels',
          description: 'Liste alle Funnels aus Systeme.io auf',
          inputSchema: zodToJsonSchema(ListFunnelsSchema),
        },
        {
          name: 'grant_course_access',
          description: 'Gib einem Kunden Zugang zu einem Systeme.io Kurs',
          inputSchema: zodToJsonSchema(GrantCourseAccessSchema),
        },

        // --- HETZNER TOOLS ---
        {
          name: 'list_servers',
          description: 'Liste alle Hetzner Cloud Server auf',
          inputSchema: zodToJsonSchema(ListServersSchema),
        },
        {
          name: 'get_server',
          description: 'Zeige Details eines bestimmten Hetzner Servers',
          inputSchema: zodToJsonSchema(GetServerSchema),
        },
        {
          name: 'provision_ki_server',
          description: 'Stelle automatisch einen neuen KI-Power Server für einen Kunden bereit (Hetzner + Cloud-Init + Docker Stack)',
          inputSchema: zodToJsonSchema(ProvisionServerSchema),
        },
        {
          name: 'delete_server',
          description: 'Lösche einen Hetzner Server (z.B. bei Kündigung)',
          inputSchema: zodToJsonSchema(DeleteServerSchema),
        },

        // --- BUSINESS TOOLS ---
        {
          name: 'revenue_report',
          description: 'Erstelle einen Umsatzbericht: aktive Server, monatlicher Umsatz, Kundenanzahl',
          inputSchema: zodToJsonSchema(GetRevenueReportSchema),
        },
      ],
    },
  ];
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

export async function callTool(name: string, args: any, config: any) {
  const systemeKey = config.systeme_api_key;
  const hetznerToken = config.hetzner_api_token;

  try {
    switch (name) {
      // --- SYSTEME.IO ---
      case 'list_contacts': {
        const result = await getContacts(systemeKey, args.page, args.limit);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'create_contact': {
        const tags = args.tags?.map((t: string) => ({ name: t }));
        const result = await createContact(systemeKey, {
          email: args.email,
          firstName: args.firstName,
          lastName: args.lastName,
          tags,
        });
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'tag_contact': {
        const result = await addTagToContact(systemeKey, args.contactId, args.tagName);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'list_sales': {
        const result = await getSales(systemeKey, args.page);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'list_funnels': {
        const result = await getFunnels(systemeKey, args.page);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'grant_course_access': {
        const result = await grantCourseAccess(systemeKey, args.courseId, args.studentEmail);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      // --- HETZNER ---
      case 'list_servers': {
        const result = await listServers(hetznerToken);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'get_server': {
        const result = await getServer(hetznerToken, args.serverId);
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'provision_ki_server': {
        const result = await provisionCustomerServer({
          systemeApiKey: systemeKey,
          hetznerApiToken: hetznerToken,
          customerEmail: args.customerEmail,
          customerId: `manual-${Date.now()}`,
          customerName: args.customerName,
          serverType: args.serverType,
          location: args.location,
        });
        return [{ type: 'tool_result', data: { content: JSON.stringify(result, null, 2) } }];
      }

      case 'delete_server': {
        const result = await deleteServer(hetznerToken, args.serverId);
        return [{ type: 'tool_result', data: { content: `Server ${args.serverId} gelöscht. ${JSON.stringify(result)}` } }];
      }

      // --- BUSINESS ---
      case 'revenue_report': {
        const serversData = await listServers(hetznerToken);
        const servers = serversData?.servers || [];
        const managed = servers.filter((s: any) => s.labels?.managed_by === 'ki-fastfood-system');
        const active = managed.filter((s: any) => s.status === 'running');

        const report = {
          activeServers: active.length,
          totalServers: managed.length,
          monthlyRevenue: `€${active.length * 99}`,
          yearlyProjection: `€${active.length * 99 * 12}`,
          hetznerCost: `~€${managed.length * 15}`, // Approx cpx31 cost
          monthlyProfit: `~€${active.length * 99 - managed.length * 15}`,
          profitMargin: managed.length > 0 ? `${Math.round(((active.length * 99 - managed.length * 15) / (active.length * 99)) * 100)}%` : 'N/A',
          servers: managed.map((s: any) => ({
            name: s.name,
            status: s.status,
            ip: s.public_net?.ipv4?.ip,
            customer: s.labels?.customer_email,
            created: s.created,
          })),
        };

        return [{ type: 'tool_result', data: { content: JSON.stringify(report, null, 2) } }];
      }

      default:
        return [{ type: 'error', data: { message: `Unknown tool: ${name}` } }];
    }
  } catch (error: any) {
    return [{ type: 'error', data: { message: error.message } }];
  }
}
