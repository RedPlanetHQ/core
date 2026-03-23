import axios from 'axios';

import { getStripeAccount } from './utils';

const STRIPE_API_BASE = 'https://api.stripe.com';
const STRIPE_VERSION = '2026-01-28.clover';

const STRIPE_WEBHOOK_EVENTS = [
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.created',
  'payment_intent.canceled',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.created',
  'invoice.finalized',
  'payout.created',
  'payout.paid',
  'payout.failed',
  'dispute.created',
  'dispute.closed',
  'refund.created',
  'account.application.deauthorized',
];

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  const account = await getStripeAccount(api_key);

  const accountId = account.id;
  const email = account.email as string | undefined;
  const displayName = (
    account.display_name ||
    account.business_profile?.name ||
    email ||
    accountId
  ) as string;

  // Automatically register webhook endpoint so Stripe pushes events in real-time
  let webhookSecret: string | undefined;
  const appOrigin = process.env.APP_ORIGIN;

  if (appOrigin) {
    try {
      const webhookUrl = `${appOrigin}/webhook/stripe`;

      // Build form-encoded body (Stripe requires this for POST endpoints)
      const params = new URLSearchParams();
      params.append('url', webhookUrl);
      for (const event of STRIPE_WEBHOOK_EVENTS) {
        params.append('enabled_events[]', event);
      }

      const response = await axios.post(
        `${STRIPE_API_BASE}/v1/webhook_endpoints`,
        params.toString(),
        {
          headers: {
            Authorization: `Bearer ${api_key}`,
            'Stripe-Version': STRIPE_VERSION,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      webhookSecret = response.data?.secret;
    } catch (err) {
      // Non-fatal: webhook registration failure should not block account setup
      console.warn('Stripe webhook registration failed:', err);
    }
  }

  return [
    {
      type: 'account',
      data: {
        settings: {
          accountId,
          email,
          displayName,
          livemode: account.livemode,
        },
        accountId,
        config: {
          access_token: api_key,
          livemode: account.livemode,
          ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
        },
      },
    },
  ];
}
