import pg from 'pg';

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const clientId = process.env.CALENDLY_CLIENT_ID;
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      'CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET environment variables are required',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString });

  const spec = {
    name: 'Calendly',
    key: 'calendly',
    description:
      'Connect your Calendly account to view and manage event types, scheduled meetings, invitees, availability, routing forms, and webhook subscriptions in CORE.',
    icon: 'calendly',
    auth: {
      OAuth2: {
        authorization_url: 'https://auth.calendly.com/oauth/authorize',
        token_url: 'https://auth.calendly.com/oauth/token',
        scopes: ['default'],
        scope_separator: ' ',
        token_request_auth_method: 'basic',
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Calendly', 'calendly', $4, 'calendly', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        '../../integrations/calendly/dist/index.js',
        spec.description,
      ],
    );

    console.log('Calendly integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Calendly integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
