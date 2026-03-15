import axios from 'axios';

const STRIPE_API_BASE = 'https://api.stripe.com';
const STRIPE_VERSION = '2026-01-28.clover';

export function createStripeClient(accessToken: string) {
  return axios.create({
    baseURL: STRIPE_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Stripe-Version': STRIPE_VERSION,
    },
  });
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
  livemode: boolean;
  request?: {
    id: string | null;
    idempotency_key: string | null;
  };
}

export async function getPaginatedStripeEvents(
  accessToken: string,
  startingAfter?: string,
  createdGte?: number,
): Promise<{ events: StripeEvent[]; hasMore: boolean; lastEventId?: string }> {
  const client = createStripeClient(accessToken);

  const params: Record<string, string | number> = {
    limit: 100,
  };

  if (startingAfter) {
    params['starting_after'] = startingAfter;
  }

  if (createdGte) {
    params['created[gte]'] = createdGte;
  }

  const response = await client.get('/v1/events', { params });
  const data = response.data;

  const events: StripeEvent[] = data.data || [];
  const hasMore: boolean = data.has_more || false;
  const lastEventId = events.length > 0 ? events[0].id : undefined;

  return { events, hasMore, lastEventId };
}

export async function getStripeAccount(accessToken: string) {
  const client = createStripeClient(accessToken);
  const response = await client.get('/v1/account');
  return response.data;
}
