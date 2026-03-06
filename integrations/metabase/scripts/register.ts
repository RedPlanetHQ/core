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
    name: 'Metabase',
    key: 'metabase',
    description:
      'Connect your Metabase instance to access dashboards, questions, database connections, and analytics activity.',
    icon: 'metabase',
    schedule: {
      frequency: '*/15 * * * *',
    },
    mcp: {
      type: 'cli',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'metabase_url',
            label: 'Metabase URL',
            placeholder: 'https://your-metabase.example.com',
            description: 'Your Metabase instance URL without a trailing slash.',
          },
          {
            name: 'api_key',
            label: 'API Key',
            placeholder: 'your-api-key',
            description:
              'Found in Metabase Admin → Settings → Authentication → API Keys.',
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
      VALUES (gen_random_uuid(), 'Metabase', 'metabase', 'Connect your Metabase instance to access dashboards, questions, database connections, and analytics activity.', 'metabase', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        '../../integrations/metabase/bin/index.js',
      ],
    );

    console.log('Metabase integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Metabase integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
