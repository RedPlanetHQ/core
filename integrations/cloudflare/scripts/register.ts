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
    name: 'Cloudflare',
    key: 'cloudflare',
    description:
      'Connect your Cloudflare account to CORE. Manage DNS records, inspect zone configurations, and purge cache — all from your workspace.',
    icon: 'cloudflare',
    mcp: {
      type: 'cli',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'api_token',
            label: 'API Token',
            placeholder: 'your-cloudflare-api-token',
            description:
              'Create an API Token in Cloudflare → My Profile → API Tokens. Grant the token Zone:Read and DNS:Edit permissions for the zones you want to manage.',
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
      VALUES (gen_random_uuid(), 'Cloudflare', 'cloudflare', 'Connect your Cloudflare account to CORE. Manage DNS records, inspect zone configurations, and purge cache — all from your workspace.', 'cloudflare', $1, $2, '0.1.0', $3, NOW(), NOW())
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
      [JSON.stringify(spec), JSON.stringify({}), '../../integrations/cloudflare/bin/index.cjs']
    );

    console.log('Cloudflare integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Cloudflare integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
