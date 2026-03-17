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
    name: 'Mixpanel',
    key: 'mixpanel',
    description:
      'Connect your Mixpanel project to CORE. Sync analytics events, user profiles, funnel metrics, retention cohorts, and annotations — all from your workspace.',
    icon: 'mixpanel',
    schedule: {
      frequency: '*/30 * * * *',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'service_account_username',
            label: 'Service Account Username',
            placeholder: 'sa-xxxxx.project.mixpanel',
            description:
              'Your Mixpanel Service Account username. Create one in Project Settings → Service Accounts.',
          },
          {
            name: 'service_account_secret',
            label: 'Service Account Secret',
            placeholder: 'your-service-account-secret',
            description: 'The secret for your Mixpanel Service Account.',
          },
          {
            name: 'project_id',
            label: 'Project ID',
            placeholder: '12345678',
            description:
              'Your Mixpanel Project ID. Found in Project Settings → Project Details.',
          },
          {
            name: 'region',
            label: 'Data Residency',
            placeholder: 'US',
            description:
              'Set to "US" for US data residency (default) or "EU" for EU data residency.',
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
      VALUES (gen_random_uuid(), 'Mixpanel', 'mixpanel', 'Connect your Mixpanel project to CORE. Sync analytics events, user profiles, funnel metrics, retention cohorts, and annotations — all from your workspace.', 'mixpanel', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        '../../integrations/mixpanel/bin/index.cjs',
      ]
    );

    console.log('Mixpanel integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Mixpanel integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
