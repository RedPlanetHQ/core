import pg from 'pg';
const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  const spec = {
    name: 'Intercom',
    key: 'intercom',
    description:
      'Connect your Intercom workspace to CORE. Sync conversations, contacts, and events — stay on top of customer support and engagement directly from your workspace.',
    icon: 'intercom',
    schedule: {
      frequency: '*/15 * * * *',
    },
    auth: {
      OAuth2: {
        token_url: 'https://api.intercom.io/auth/eagle/token',
        authorization_url: 'https://app.intercom.com/oauth',
        scopes: ['read_users', 'read_conversations'],
        scope_separator: ' ',
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Intercom', 'intercom', 'Connect your Intercom workspace to CORE. Sync conversations, contacts, and events — stay on top of customer support and engagement directly from your workspace.', 'intercom', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        JSON.stringify({}),
        '../../integrations/intercom/bin/index.cjs',
      ],
    );

    console.log('Intercom integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Intercom integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
