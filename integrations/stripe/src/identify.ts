import crypto from 'crypto';

interface Account {
  id: string;
  accountId: string;
  config: Record<string, unknown> | null;
}

function verifyStripeSignature(rawBody: string, signature: string, secret: string): boolean {
  const parts = signature.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

  if (!timestamp || sigs.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  return sigs.some((sig) => sig === expected);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function identify(webhookData: any) {
  const signature = webhookData.eventHeaders?.['stripe-signature'] as string | undefined;
  const rawBody = webhookData.rawBody as string | undefined;
  const accounts = webhookData.accounts as Account[] | undefined;

  if (!signature || !rawBody || !accounts?.length) return [];

  for (const account of accounts) {
    const webhookSecret = account.config?.webhook_secret as string | undefined;
    if (!webhookSecret) continue;

    if (verifyStripeSignature(rawBody, signature, webhookSecret)) {
      return [{ type: 'identifier', data: account.accountId }];
    }
  }

  return [];
}
