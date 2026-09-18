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
    name: 'Google Analytics',
    key: 'google-analytics',
    description:
      'Connect your workspace to Google Analytics 4. Query reports, real-time data, funnels, and property metadata directly from CORE.',
    icon: 'google-analytics',
    mcp: {
      type: 'cli',
    },
    auth: {
      OAuth2: {
        token_url: 'https://oauth2.googleapis.com/token',
        authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: [
          'https://www.googleapis.com/auth/analytics.readonly',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email',
        ],
        scope_identifier: 'scope',
        scope_separator: ' ',
        token_params: {
          access_type: 'offline',
          prompt: 'consent',
        },
        authorization_params: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    },
  };

  try {
    await client.connect();

    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Google Analytics', 'google-analytics', 'Connect your workspace to Google Analytics 4. Query reports, real-time data, funnels, and property metadata directly from CORE.', 'google-analytics', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        '../../integrations/google-analytics/bin/index.cjs',
      ]
    );

    console.log('Google Analytics integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Google Analytics integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
