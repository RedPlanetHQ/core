import pg from 'pg';

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const clientId = process.env.STRIPE_CLIENT_ID;
  const clientSecret = process.env.STRIPE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('STRIPE_CLIENT_ID and STRIPE_CLIENT_SECRET environment variables are required');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  const spec = {
    name: 'Stripe',
    key: 'stripe',
    description:
      'Connect your Stripe account to track payments, subscriptions, customers, invoices, disputes, and payouts in CORE.',
    icon: 'stripe',
    schedule: {
      frequency: '0 */6 * * *',
    },
    auth: {
      OAuth2: {
        token_url: 'https://connect.stripe.com/oauth/token',
        authorization_url: 'https://connect.stripe.com/oauth/authorize',
        scopes: ['read_only'],
        scope_separator: ' ',
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Stripe', 'stripe', 'Connect your Stripe account to track payments, subscriptions, customers, invoices, disputes, and payouts in CORE.', 'stripe', $1, $2, '0.1.0', $3, NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET
        "slug" = EXCLUDED."slug",
        "description" = EXCLUDED."description",
        "icon" = EXCLUDED."icon",
        "spec" = EXCLUDED."spec",
        "config" = EXCLUDED."config",
        "version" = EXCLUDED."version",
        "url" = EXCLUDED."url",
        "updatedAt" = NOW()
      RETURNING *;
    `,
      [
        JSON.stringify(spec),
        JSON.stringify({ clientId, clientSecret }),
        '../../integrations/stripe/dist/index.js',
      ],
    );

    console.log('Stripe integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Stripe integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
