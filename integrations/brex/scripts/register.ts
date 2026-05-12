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
    name: 'Brex',
    key: 'brex',
    description:
      'Connect Brex read-only to surface card transactions, statements, and spend summaries in CORE.',
    icon: 'brex',
    mcp: {
      type: 'cli',
    },
    schedule: {
      frequency: '0 */4 * * *',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'api_key',
            label: 'Customer Token',
            placeholder: 'brex_user_token_...',
            description:
              'Your Brex customer token with read-only scopes (accounts.readonly, transactions.readonly). Create one in Brex Dashboard → Developer → Create Token.',
          },
        ],
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Brex', 'brex', 'Connect Brex read-only to surface card transactions, statements, and spend summaries in CORE.', 'brex', $1, $2, '0.1.0', $3, NOW(), NOW())
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
      [JSON.stringify(spec), JSON.stringify({}), '../../integrations/brex/dist/index.js'],
    );

    console.log('Brex integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Brex integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
