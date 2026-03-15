import { StripeEvent } from './utils';

function formatAmount(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || currency === undefined) {
    return '';
  }
  const formatted = (amount / 100).toFixed(2);
  return `${formatted} ${currency.toUpperCase()}`;
}

function getDashboardUrl(event: StripeEvent): string {
  const obj = event.data.object as Record<string, unknown>;
  const base = event.livemode
    ? 'https://dashboard.stripe.com'
    : 'https://dashboard.stripe.com/test';

  const type = event.type;

  if (type.startsWith('charge.')) {
    return `${base}/charges/${obj['id']}`;
  }
  if (type.startsWith('customer.subscription.')) {
    return `${base}/subscriptions/${obj['id']}`;
  }
  if (type.startsWith('customer.')) {
    return `${base}/customers/${obj['id']}`;
  }
  if (type.startsWith('invoice.')) {
    return `${base}/invoices/${obj['id']}`;
  }
  if (type.startsWith('payment_intent.')) {
    return `${base}/payments/${obj['id']}`;
  }
  if (type.startsWith('payout.')) {
    return `${base}/payouts/${obj['id']}`;
  }
  if (type.startsWith('dispute.')) {
    return `${base}/disputes/${obj['id']}`;
  }
  if (type.startsWith('refund.')) {
    return `${base}/refunds/${obj['id']}`;
  }

  return `${base}/events/${event.id}`;
}

function describeEvent(event: StripeEvent): string | null {
  const obj = event.data.object as Record<string, unknown>;
  const amount = obj['amount'] as number | undefined;
  const amountTotal = obj['amount_total'] as number | undefined;
  const currency = obj['currency'] as string | undefined;
  const customerId = obj['customer'] as string | undefined;
  const desc = obj['description'] as string | undefined;

  switch (event.type) {
    // Charges
    case 'charge.succeeded':
      return `Payment succeeded: ${formatAmount(amount, currency)}${customerId ? ` from customer ${customerId}` : ''}${desc ? ` — ${desc}` : ''}`;
    case 'charge.failed':
      return `Payment failed: ${formatAmount(amount, currency)}${customerId ? ` from customer ${customerId}` : ''}`;
    case 'charge.refunded':
      return `Charge refunded: ${formatAmount(amount, currency)}`;
    case 'charge.dispute.created':
      return `Dispute opened: ${formatAmount(amount, currency)}`;
    case 'charge.dispute.closed': {
      const status = obj['status'] as string | undefined;
      return `Dispute closed (${status || 'unknown'}): ${formatAmount(amount, currency)}`;
    }

    // Payment intents
    case 'payment_intent.succeeded':
      return `Payment intent succeeded: ${formatAmount(amount, currency)}`;
    case 'payment_intent.payment_failed':
      return `Payment intent failed: ${formatAmount(amount, currency)}`;
    case 'payment_intent.created':
      return `Payment intent created: ${formatAmount(amount, currency)}`;
    case 'payment_intent.canceled':
      return `Payment intent canceled: ${formatAmount(amount, currency)}`;

    // Subscriptions
    case 'customer.subscription.created': {
      const status = obj['status'] as string | undefined;
      return `Subscription created (${status || ''})${customerId ? ` for customer ${customerId}` : ''}`;
    }
    case 'customer.subscription.updated': {
      const status = obj['status'] as string | undefined;
      return `Subscription updated — status: ${status || 'unknown'}${customerId ? ` for customer ${customerId}` : ''}`;
    }
    case 'customer.subscription.deleted':
      return `Subscription canceled${customerId ? ` for customer ${customerId}` : ''}`;
    case 'customer.subscription.trial_will_end':
      return `Subscription trial ending soon${customerId ? ` for customer ${customerId}` : ''}`;

    // Customers
    case 'customer.created': {
      const email = obj['email'] as string | undefined;
      return `New customer created${email ? `: ${email}` : ''}`;
    }
    case 'customer.updated': {
      const email = obj['email'] as string | undefined;
      return `Customer updated${email ? `: ${email}` : ''}`;
    }
    case 'customer.deleted': {
      const email = obj['email'] as string | undefined;
      return `Customer deleted${email ? `: ${email}` : ''}`;
    }

    // Invoices
    case 'invoice.paid': {
      const total = amountTotal ?? (obj['amount_paid'] as number | undefined);
      const inv_currency = currency ?? (obj['currency'] as string | undefined);
      return `Invoice paid: ${formatAmount(total, inv_currency)}${customerId ? ` from customer ${customerId}` : ''}`;
    }
    case 'invoice.payment_failed': {
      const total = amountTotal ?? (obj['amount_due'] as number | undefined);
      const inv_currency = currency ?? (obj['currency'] as string | undefined);
      return `Invoice payment failed: ${formatAmount(total, inv_currency)}${customerId ? ` from customer ${customerId}` : ''}`;
    }
    case 'invoice.created':
      return `Invoice created${customerId ? ` for customer ${customerId}` : ''}`;
    case 'invoice.finalized':
      return `Invoice finalized${customerId ? ` for customer ${customerId}` : ''}`;

    // Payouts
    case 'payout.created':
      return `Payout created: ${formatAmount(amount, currency)}`;
    case 'payout.paid':
      return `Payout paid: ${formatAmount(amount, currency)}`;
    case 'payout.failed':
      return `Payout failed: ${formatAmount(amount, currency)}`;

    // Disputes
    case 'dispute.created':
      return `Dispute created: ${formatAmount(amount, currency)}`;
    case 'dispute.closed': {
      const status = obj['status'] as string | undefined;
      return `Dispute closed (${status || 'unknown'}): ${formatAmount(amount, currency)}`;
    }

    // Refunds
    case 'refund.created':
      return `Refund created: ${formatAmount(amount, currency)}`;

    // Account deauth
    case 'account.application.deauthorized':
      return 'Stripe account disconnected from CORE';

    default:
      return null;
  }
}

export function createActivity(event: StripeEvent) {
  const text = describeEvent(event);

  if (!text) {
    return null;
  }

  return {
    type: 'activity',
    data: {
      text,
      sourceURL: getDashboardUrl(event),
    },
  };
}
