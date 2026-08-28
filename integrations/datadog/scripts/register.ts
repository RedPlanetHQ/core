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
    name: 'Datadog',
    key: 'datadog',
    description:
      'Connect Datadog to CORE to surface monitor alerts and infrastructure events as activities.',
    icon: 'datadog',
    schedule: {
      frequency: '*/15 * * * *',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'api_key',
            label: 'API Key (DD-API-KEY)',
            placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            description:
              'Your Datadog API key. Found in Datadog → Organization Settings → API Keys.',
          },
          {
            name: 'app_key',
            label: 'Application Key (DD-APPLICATION-KEY)',
            placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            description:
              'Your Datadog Application key. Found in Datadog → Organization Settings → Application Keys.',
          },
          {
            name: 'region',
            label: 'Region',
            placeholder: 'US1',
            description:
              'Your Datadog region. One of: US1, US3, US5, EU, AP1. Defaults to US1.',
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
      VALUES (gen_random_uuid(), 'Datadog', 'datadog', 'Connect Datadog to CORE to surface monitor alerts and infrastructure events as activities.', 'datadog', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        '../../integrations/datadog/dist/index.js',
      ],
    );

    console.log('Datadog integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Datadog integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
