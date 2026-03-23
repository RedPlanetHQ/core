import axios from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const STRIPE_API_BASE = 'https://api.stripe.com';
const STRIPE_VERSION = '2026-01-28.clover';

function createClient(accessToken: string) {
  return axios.create({
    baseURL: STRIPE_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Stripe-Version': STRIPE_VERSION,
    },
  });
}

function text(data: unknown) {
  return [{ type: 'text', text: JSON.stringify(data, null, 2) }];
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of results (max 100)'),
  starting_after: z.string().optional().describe('Cursor for pagination (object ID)'),
});

const IdSchema = z.object({
  id: z.string().describe('Object ID'),
});

const ListCustomersSchema = ListSchema.extend({
  email: z.string().optional().describe('Filter by customer email'),
});

const ListChargesSchema = ListSchema.extend({
  customer: z.string().optional().describe('Filter by customer ID'),
});

const ListInvoicesSchema = ListSchema.extend({
  customer: z.string().optional().describe('Filter by customer ID'),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional(),
});

const ListSubscriptionsSchema = ListSchema.extend({
  customer: z.string().optional().describe('Filter by customer ID'),
  status: z
    .enum(['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'trialing', 'all'])
    .optional(),
});

const ListPaymentIntentsSchema = ListSchema.extend({
  customer: z.string().optional().describe('Filter by customer ID'),
});

const ListDisputesSchema = ListSchema.extend({
  charge: z.string().optional().describe('Filter by charge ID'),
});

const ListPayoutsSchema = ListSchema.extend({
  status: z.enum(['paid', 'pending', 'in_transit', 'canceled', 'failed']).optional(),
});

// ─── Tool definitions ────────────────────────────────────────────────────────

export function getTools() {
  return [
    { name: 'list_customers', description: 'List Stripe customers', inputSchema: zodToJsonSchema(ListCustomersSchema) },
    { name: 'get_customer', description: 'Get a Stripe customer by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_charges', description: 'List charges', inputSchema: zodToJsonSchema(ListChargesSchema) },
    { name: 'get_charge', description: 'Get a charge by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_invoices', description: 'List invoices', inputSchema: zodToJsonSchema(ListInvoicesSchema) },
    { name: 'get_invoice', description: 'Get an invoice by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_subscriptions', description: 'List subscriptions', inputSchema: zodToJsonSchema(ListSubscriptionsSchema) },
    { name: 'get_subscription', description: 'Get a subscription by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_products', description: 'List products', inputSchema: zodToJsonSchema(ListSchema) },
    { name: 'get_product', description: 'Get a product by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_payment_intents', description: 'List payment intents', inputSchema: zodToJsonSchema(ListPaymentIntentsSchema) },
    { name: 'get_payment_intent', description: 'Get a payment intent by ID', inputSchema: zodToJsonSchema(IdSchema) },
    { name: 'list_disputes', description: 'List disputes', inputSchema: zodToJsonSchema(ListDisputesSchema) },
    { name: 'list_payouts', description: 'List payouts', inputSchema: zodToJsonSchema(ListPayoutsSchema) },
  ];
}

// ─── Tool execution ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool(name: string, args: Record<string, any>, config: Record<string, any>) {
  const accessToken = config?.access_token as string;
  if (!accessToken) throw new Error('No access_token in config');

  const client = createClient(accessToken);

  switch (name) {
    case 'list_customers': {
      const { limit, starting_after, email } = ListCustomersSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (email) params.email = email;
      const res = await client.get('/v1/customers', { params });
      return text(res.data);
    }
    case 'get_customer': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/customers/${id}`);
      return text(res.data);
    }
    case 'list_charges': {
      const { limit, starting_after, customer } = ListChargesSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (customer) params.customer = customer;
      const res = await client.get('/v1/charges', { params });
      return text(res.data);
    }
    case 'get_charge': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/charges/${id}`);
      return text(res.data);
    }
    case 'list_invoices': {
      const { limit, starting_after, customer, status } = ListInvoicesSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (customer) params.customer = customer;
      if (status) params.status = status;
      const res = await client.get('/v1/invoices', { params });
      return text(res.data);
    }
    case 'get_invoice': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/invoices/${id}`);
      return text(res.data);
    }
    case 'list_subscriptions': {
      const { limit, starting_after, customer, status } = ListSubscriptionsSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (customer) params.customer = customer;
      if (status) params.status = status;
      const res = await client.get('/v1/subscriptions', { params });
      return text(res.data);
    }
    case 'get_subscription': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/subscriptions/${id}`);
      return text(res.data);
    }
    case 'list_products': {
      const { limit, starting_after } = ListSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      const res = await client.get('/v1/products', { params });
      return text(res.data);
    }
    case 'get_product': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/products/${id}`);
      return text(res.data);
    }
    case 'list_payment_intents': {
      const { limit, starting_after, customer } = ListPaymentIntentsSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (customer) params.customer = customer;
      const res = await client.get('/v1/payment_intents', { params });
      return text(res.data);
    }
    case 'get_payment_intent': {
      const { id } = IdSchema.parse(args);
      const res = await client.get(`/v1/payment_intents/${id}`);
      return text(res.data);
    }
    case 'list_disputes': {
      const { limit, starting_after, charge } = ListDisputesSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (charge) params.charge = charge;
      const res = await client.get('/v1/disputes', { params });
      return text(res.data);
    }
    case 'list_payouts': {
      const { limit, starting_after, status } = ListPayoutsSchema.parse(args);
      const params: Record<string, unknown> = { limit };
      if (starting_after) params.starting_after = starting_after;
      if (status) params.status = status;
      const res = await client.get('/v1/payouts', { params });
      return text(res.data);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
