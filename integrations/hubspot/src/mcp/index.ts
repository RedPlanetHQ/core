import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// HubSpot API client
let hubspotClient: AxiosInstance;

/**
 * Initialize HubSpot client with OAuth credentials
 */
async function initializeClient(
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  // Try to refresh token if refresh_token exists
  if (credentials.refresh_token) {
    try {
      const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
        params: {
          grant_type: 'refresh_token',
          client_id: client_id,
          client_secret: client_secret,
          refresh_token: credentials.refresh_token,
        },
      });

      credentials.access_token = tokenResponse.data.access_token;
      if (tokenResponse.data.refresh_token) {
        credentials.refresh_token = tokenResponse.data.refresh_token;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }

  hubspotClient = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
    },
  });
}

// Schema definitions for Contacts
const CreateContactSchema = z.object({
  email: z.string().email().describe('Email address of the contact'),
  firstname: z.string().optional().describe('First name'),
  lastname: z.string().optional().describe('Last name'),
  phone: z.string().optional().describe('Phone number'),
  company: z.string().optional().describe('Company name'),
  website: z.string().optional().describe('Website URL'),
  jobtitle: z.string().optional().describe('Job title'),
  lifecyclestage: z
    .string()
    .optional()
    .describe('Lifecycle stage (e.g., lead, customer, opportunity)'),
});

const GetContactSchema = z.object({
  contactId: z.string().describe('ID of the contact to retrieve'),
});

const UpdateContactSchema = z.object({
  contactId: z.string().describe('ID of the contact to update'),
  properties: z.record(z.any()).describe('Properties to update'),
});

const SearchContactsSchema = z.object({
  query: z.string().optional().describe('Search query text'),
  filterGroups: z
    .array(
      z.object({
        filters: z.array(
          z.object({
            propertyName: z.string(),
            operator: z.enum([
              'EQ',
              'NEQ',
              'LT',
              'LTE',
              'GT',
              'GTE',
              'CONTAINS_TOKEN',
              'NOT_CONTAINS_TOKEN',
            ]),
            value: z.string(),
          })
        ),
      })
    )
    .optional()
    .describe('Filter groups for advanced filtering'),
  limit: z.number().optional().default(10).describe('Maximum number of results'),
});

const DeleteContactSchema = z.object({
  contactId: z.string().describe('ID of the contact to delete'),
});

// Schema definitions for Companies
const CreateCompanySchema = z.object({
  name: z.string().describe('Company name'),
  domain: z.string().optional().describe('Company domain'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State'),
  industry: z.string().optional().describe('Industry'),
  phone: z.string().optional().describe('Phone number'),
  numberofemployees: z.string().optional().describe('Number of employees'),
});

const GetCompanySchema = z.object({
  companyId: z.string().describe('ID of the company to retrieve'),
});

const UpdateCompanySchema = z.object({
  companyId: z.string().describe('ID of the company to update'),
  properties: z.record(z.any()).describe('Properties to update'),
});

const SearchCompaniesSchema = z.object({
  query: z.string().optional().describe('Search query text'),
  filterGroups: z
    .array(
      z.object({
        filters: z.array(
          z.object({
            propertyName: z.string(),
            operator: z.enum([
              'EQ',
              'NEQ',
              'LT',
              'LTE',
              'GT',
              'GTE',
              'CONTAINS_TOKEN',
              'NOT_CONTAINS_TOKEN',
            ]),
            value: z.string(),
          })
        ),
      })
    )
    .optional()
    .describe('Filter groups for advanced filtering'),
  limit: z.number().optional().default(10).describe('Maximum number of results'),
});

const DeleteCompanySchema = z.object({
  companyId: z.string().describe('ID of the company to delete'),
});

// Schema definitions for Deals
const CreateDealSchema = z.object({
  dealname: z.string().describe('Name of the deal'),
  dealstage: z.string().describe('Deal stage ID'),
  pipeline: z.string().optional().describe('Pipeline ID'),
  amount: z.string().optional().describe('Deal amount'),
  closedate: z.string().optional().describe('Close date (ISO format or timestamp)'),
  hubspot_owner_id: z.string().optional().describe('Owner ID'),
});

const GetDealSchema = z.object({
  dealId: z.string().describe('ID of the deal to retrieve'),
});

const UpdateDealSchema = z.object({
  dealId: z.string().describe('ID of the deal to update'),
  properties: z.record(z.any()).describe('Properties to update'),
});

const SearchDealsSchema = z.object({
  query: z.string().optional().describe('Search query text'),
  filterGroups: z
    .array(
      z.object({
        filters: z.array(
          z.object({
            propertyName: z.string(),
            operator: z.enum([
              'EQ',
              'NEQ',
              'LT',
              'LTE',
              'GT',
              'GTE',
              'CONTAINS_TOKEN',
              'NOT_CONTAINS_TOKEN',
            ]),
            value: z.string(),
          })
        ),
      })
    )
    .optional()
    .describe('Filter groups for advanced filtering'),
  limit: z.number().optional().default(10).describe('Maximum number of results'),
});

const DeleteDealSchema = z.object({
  dealId: z.string().describe('ID of the deal to delete'),
});

// Schema definitions for Tickets
const CreateTicketSchema = z.object({
  subject: z.string().describe('Ticket subject'),
  content: z.string().optional().describe('Ticket content/description'),
  hs_pipeline_stage: z.string().describe('Pipeline stage ID'),
  hs_pipeline: z.string().optional().describe('Pipeline ID'),
  hs_ticket_priority: z.string().optional().describe('Priority (LOW, MEDIUM, HIGH)'),
});

const GetTicketSchema = z.object({
  ticketId: z.string().describe('ID of the ticket to retrieve'),
});

const UpdateTicketSchema = z.object({
  ticketId: z.string().describe('ID of the ticket to update'),
  properties: z.record(z.any()).describe('Properties to update'),
});

const SearchTicketsSchema = z.object({
  query: z.string().optional().describe('Search query text'),
  filterGroups: z
    .array(
      z.object({
        filters: z.array(
          z.object({
            propertyName: z.string(),
            operator: z.enum([
              'EQ',
              'NEQ',
              'LT',
              'LTE',
              'GT',
              'GTE',
              'CONTAINS_TOKEN',
              'NOT_CONTAINS_TOKEN',
            ]),
            value: z.string(),
          })
        ),
      })
    )
    .optional()
    .describe('Filter groups for advanced filtering'),
  limit: z.number().optional().default(10).describe('Maximum number of results'),
});

const DeleteTicketSchema = z.object({
  ticketId: z.string().describe('ID of the ticket to delete'),
});

// Association schemas
const AssociateObjectsSchema = z.object({
  fromObjectType: z
    .enum(['contacts', 'companies', 'deals', 'tickets'])
    .describe('Type of the source object'),
  fromObjectId: z.string().describe('ID of the source object'),
  toObjectType: z
    .enum(['contacts', 'companies', 'deals', 'tickets'])
    .describe('Type of the target object'),
  toObjectId: z.string().describe('ID of the target object'),
  associationType: z
    .string()
    .optional()
    .describe('Association type ID (if not provided, uses default)'),
});

/**
 * Get list of available tools
 */
export async function getTools() {
  return [
    // Contact tools
    {
      name: 'create_contact',
      description: 'Creates a new contact in HubSpot',
      inputSchema: zodToJsonSchema(CreateContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_contact',
      description: 'Retrieves a contact by ID',
      inputSchema: zodToJsonSchema(GetContactSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_contact',
      description: 'Updates a contact',
      inputSchema: zodToJsonSchema(UpdateContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_contacts',
      description: 'Searches for contacts',
      inputSchema: zodToJsonSchema(SearchContactsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_contact',
      description: 'Deletes a contact',
      inputSchema: zodToJsonSchema(DeleteContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Company tools
    {
      name: 'create_company',
      description: 'Creates a new company in HubSpot',
      inputSchema: zodToJsonSchema(CreateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_company',
      description: 'Retrieves a company by ID',
      inputSchema: zodToJsonSchema(GetCompanySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_company',
      description: 'Updates a company',
      inputSchema: zodToJsonSchema(UpdateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_companies',
      description: 'Searches for companies',
      inputSchema: zodToJsonSchema(SearchCompaniesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_company',
      description: 'Deletes a company',
      inputSchema: zodToJsonSchema(DeleteCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Deal tools
    {
      name: 'create_deal',
      description: 'Creates a new deal in HubSpot',
      inputSchema: zodToJsonSchema(CreateDealSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_deal',
      description: 'Retrieves a deal by ID',
      inputSchema: zodToJsonSchema(GetDealSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_deal',
      description: 'Updates a deal',
      inputSchema: zodToJsonSchema(UpdateDealSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_deals',
      description: 'Searches for deals',
      inputSchema: zodToJsonSchema(SearchDealsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_deal',
      description: 'Deletes a deal',
      inputSchema: zodToJsonSchema(DeleteDealSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Ticket tools
    {
      name: 'create_ticket',
      description: 'Creates a new ticket in HubSpot',
      inputSchema: zodToJsonSchema(CreateTicketSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_ticket',
      description: 'Retrieves a ticket by ID',
      inputSchema: zodToJsonSchema(GetTicketSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_ticket',
      description: 'Updates a ticket',
      inputSchema: zodToJsonSchema(UpdateTicketSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_tickets',
      description: 'Searches for tickets',
      inputSchema: zodToJsonSchema(SearchTicketsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_ticket',
      description: 'Deletes a ticket',
      inputSchema: zodToJsonSchema(DeleteTicketSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Association tool
    {
      name: 'associate_objects',
      description: 'Creates an association between two HubSpot objects',
      inputSchema: zodToJsonSchema(AssociateObjectsSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/**
 * Call a specific tool
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  await initializeClient(client_id, client_secret, callback, credentials);

  try {
    switch (name) {
      // Contact operations
      case 'create_contact': {
        const validatedArgs = CreateContactSchema.parse(args);
        const response = await hubspotClient.post('/crm/v3/objects/contacts', {
          properties: validatedArgs,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Contact created successfully:\nID: ${response.data.id}\nEmail: ${response.data.properties.email}`,
            },
          ],
        };
      }

      case 'get_contact': {
        const validatedArgs = GetContactSchema.parse(args);
        const response = await hubspotClient.get(
          `/crm/v3/objects/contacts/${validatedArgs.contactId}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Contact details:\nID: ${response.data.id}\n${JSON.stringify(response.data.properties, null, 2)}`,
            },
          ],
        };
      }

      case 'update_contact': {
        const validatedArgs = UpdateContactSchema.parse(args);
        const response = await hubspotClient.patch(
          `/crm/v3/objects/contacts/${validatedArgs.contactId}`,
          {
            properties: validatedArgs.properties,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Contact updated successfully:\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'search_contacts': {
        const validatedArgs = SearchContactsSchema.parse(args);
        const searchBody: any = {
          limit: validatedArgs.limit,
        };

        if (validatedArgs.query) {
          searchBody.query = validatedArgs.query;
        }

        if (validatedArgs.filterGroups) {
          searchBody.filterGroups = validatedArgs.filterGroups;
        }

        const response = await hubspotClient.post('/crm/v3/objects/contacts/search', searchBody);

        const results = response.data.results
          .map(
            (contact: any) =>
              `ID: ${contact.id}\nEmail: ${contact.properties.email || 'N/A'}\nName: ${contact.properties.firstname || ''} ${contact.properties.lastname || ''}\n`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.total} contacts:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_contact': {
        const validatedArgs = DeleteContactSchema.parse(args);
        await hubspotClient.delete(`/crm/v3/objects/contacts/${validatedArgs.contactId}`);

        return {
          content: [
            {
              type: 'text',
              text: `Contact ${validatedArgs.contactId} deleted successfully`,
            },
          ],
        };
      }

      // Company operations
      case 'create_company': {
        const validatedArgs = CreateCompanySchema.parse(args);
        const response = await hubspotClient.post('/crm/v3/objects/companies', {
          properties: validatedArgs,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Company created successfully:\nID: ${response.data.id}\nName: ${response.data.properties.name}`,
            },
          ],
        };
      }

      case 'get_company': {
        const validatedArgs = GetCompanySchema.parse(args);
        const response = await hubspotClient.get(
          `/crm/v3/objects/companies/${validatedArgs.companyId}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Company details:\nID: ${response.data.id}\n${JSON.stringify(response.data.properties, null, 2)}`,
            },
          ],
        };
      }

      case 'update_company': {
        const validatedArgs = UpdateCompanySchema.parse(args);
        const response = await hubspotClient.patch(
          `/crm/v3/objects/companies/${validatedArgs.companyId}`,
          {
            properties: validatedArgs.properties,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Company updated successfully:\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'search_companies': {
        const validatedArgs = SearchCompaniesSchema.parse(args);
        const searchBody: any = {
          limit: validatedArgs.limit,
        };

        if (validatedArgs.query) {
          searchBody.query = validatedArgs.query;
        }

        if (validatedArgs.filterGroups) {
          searchBody.filterGroups = validatedArgs.filterGroups;
        }

        const response = await hubspotClient.post('/crm/v3/objects/companies/search', searchBody);

        const results = response.data.results
          .map(
            (company: any) =>
              `ID: ${company.id}\nName: ${company.properties.name || 'N/A'}\nDomain: ${company.properties.domain || 'N/A'}\n`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.total} companies:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_company': {
        const validatedArgs = DeleteCompanySchema.parse(args);
        await hubspotClient.delete(`/crm/v3/objects/companies/${validatedArgs.companyId}`);

        return {
          content: [
            {
              type: 'text',
              text: `Company ${validatedArgs.companyId} deleted successfully`,
            },
          ],
        };
      }

      // Deal operations
      case 'create_deal': {
        const validatedArgs = CreateDealSchema.parse(args);
        const response = await hubspotClient.post('/crm/v3/objects/deals', {
          properties: validatedArgs,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Deal created successfully:\nID: ${response.data.id}\nName: ${response.data.properties.dealname}`,
            },
          ],
        };
      }

      case 'get_deal': {
        const validatedArgs = GetDealSchema.parse(args);
        const response = await hubspotClient.get(`/crm/v3/objects/deals/${validatedArgs.dealId}`);

        return {
          content: [
            {
              type: 'text',
              text: `Deal details:\nID: ${response.data.id}\n${JSON.stringify(response.data.properties, null, 2)}`,
            },
          ],
        };
      }

      case 'update_deal': {
        const validatedArgs = UpdateDealSchema.parse(args);
        const response = await hubspotClient.patch(
          `/crm/v3/objects/deals/${validatedArgs.dealId}`,
          {
            properties: validatedArgs.properties,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Deal updated successfully:\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'search_deals': {
        const validatedArgs = SearchDealsSchema.parse(args);
        const searchBody: any = {
          limit: validatedArgs.limit,
        };

        if (validatedArgs.query) {
          searchBody.query = validatedArgs.query;
        }

        if (validatedArgs.filterGroups) {
          searchBody.filterGroups = validatedArgs.filterGroups;
        }

        const response = await hubspotClient.post('/crm/v3/objects/deals/search', searchBody);

        const results = response.data.results
          .map(
            (deal: any) =>
              `ID: ${deal.id}\nName: ${deal.properties.dealname || 'N/A'}\nAmount: ${deal.properties.amount || 'N/A'}\nStage: ${deal.properties.dealstage || 'N/A'}\n`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.total} deals:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_deal': {
        const validatedArgs = DeleteDealSchema.parse(args);
        await hubspotClient.delete(`/crm/v3/objects/deals/${validatedArgs.dealId}`);

        return {
          content: [
            {
              type: 'text',
              text: `Deal ${validatedArgs.dealId} deleted successfully`,
            },
          ],
        };
      }

      // Ticket operations
      case 'create_ticket': {
        const validatedArgs = CreateTicketSchema.parse(args);
        const response = await hubspotClient.post('/crm/v3/objects/tickets', {
          properties: validatedArgs,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Ticket created successfully:\nID: ${response.data.id}\nSubject: ${response.data.properties.subject}`,
            },
          ],
        };
      }

      case 'get_ticket': {
        const validatedArgs = GetTicketSchema.parse(args);
        const response = await hubspotClient.get(
          `/crm/v3/objects/tickets/${validatedArgs.ticketId}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Ticket details:\nID: ${response.data.id}\n${JSON.stringify(response.data.properties, null, 2)}`,
            },
          ],
        };
      }

      case 'update_ticket': {
        const validatedArgs = UpdateTicketSchema.parse(args);
        const response = await hubspotClient.patch(
          `/crm/v3/objects/tickets/${validatedArgs.ticketId}`,
          {
            properties: validatedArgs.properties,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Ticket updated successfully:\nID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'search_tickets': {
        const validatedArgs = SearchTicketsSchema.parse(args);
        const searchBody: any = {
          limit: validatedArgs.limit,
        };

        if (validatedArgs.query) {
          searchBody.query = validatedArgs.query;
        }

        if (validatedArgs.filterGroups) {
          searchBody.filterGroups = validatedArgs.filterGroups;
        }

        const response = await hubspotClient.post('/crm/v3/objects/tickets/search', searchBody);

        const results = response.data.results
          .map(
            (ticket: any) =>
              `ID: ${ticket.id}\nSubject: ${ticket.properties.subject || 'N/A'}\nStatus: ${ticket.properties.hs_pipeline_stage || 'N/A'}\n`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.total} tickets:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_ticket': {
        const validatedArgs = DeleteTicketSchema.parse(args);
        await hubspotClient.delete(`/crm/v3/objects/tickets/${validatedArgs.ticketId}`);

        return {
          content: [
            {
              type: 'text',
              text: `Ticket ${validatedArgs.ticketId} deleted successfully`,
            },
          ],
        };
      }

      // Association operations
      case 'associate_objects': {
        const validatedArgs = AssociateObjectsSchema.parse(args);

        // Build association type based on object types
        const associationTypeId = validatedArgs.associationType || 'default';

        await hubspotClient.put(
          `/crm/v3/objects/${validatedArgs.fromObjectType}/${validatedArgs.fromObjectId}/associations/${validatedArgs.toObjectType}/${validatedArgs.toObjectId}/${associationTypeId}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Associated ${validatedArgs.fromObjectType} ${validatedArgs.fromObjectId} with ${validatedArgs.toObjectType} ${validatedArgs.toObjectId}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.message || error.response?.data?.error || error.message;
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
}
