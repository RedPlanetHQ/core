import pg from 'pg';
const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
  });

  const spec = {
    name: 'Meta Ads',
    key: 'meta-ads',
    description:
      'Connect your Meta Ads account to manage campaigns, ad sets, ads, and retrieve performance insights across Facebook and Instagram.',
    icon: 'meta-ads',
    mcp: {
      type: 'cli',
    },
    auth: {
      OAuth2: {
        authorization_url: 'https://www.facebook.com/v19.0/dialog/oauth',
        token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
        scopes: ['ads_read', 'ads_management', 'read_insights'],
        scope_separator: ',',
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Meta Ads', 'meta-ads', $4, 'meta-ads', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        JSON.stringify({
          clientId: process.env.META_ADS_CLIENT_ID,
          clientSecret: process.env.META_ADS_CLIENT_SECRET,
        }),
        '../../integrations/meta-ads/bin/index.cjs',
        'Connect your Meta Ads account to manage campaigns, ad sets, ads, and retrieve performance insights across Facebook and Instagram.',
      ],
    );

    console.log('Meta Ads integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Meta Ads integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
