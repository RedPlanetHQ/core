/**
 * Register (or update) the Google Analytics integration definition in the database.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/register.ts
 *
 * Prerequisites:
 *   - Run `pnpm build` first so the CLI binary exists at bin/index.js
 *   - Set the DATABASE_URL environment variable to your Postgres connection string
 *   - Ensure the Google OAuth 2.0 credentials (Client ID + Secret) exist in the DB
 *     or supply them via environment variables GOOGLE_ANALYTICS_CLIENT_ID /
 *     GOOGLE_ANALYTICS_CLIENT_SECRET (the script stores them in the `config` column).
 */

import pg from 'pg';

const { Client } = pg;

const INTEGRATION_NAME = 'Google Analytics';
const INTEGRATION_SLUG = 'google-analytics';
const INTEGRATION_VERSION = '0.1.0';

const spec = {
  name: INTEGRATION_NAME,
  key: INTEGRATION_SLUG,
  description:
    'Connect your workspace to Google Analytics 4. Query reports, monitor real-time traffic, explore dimensions and metrics, and receive 6-hour traffic summary activities.',
  icon: INTEGRATION_SLUG,
  mcp: {
    type: 'cli',
  },
  schedule: {
    frequency: '0 */6 * * *',
  },
  auth: {
    OAuth2: {
      token_url: 'https://oauth2.googleapis.com/token',
      authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      scopes: [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
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
  toolUISupported: true,
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  // OAuth credentials are stored in the `config` column.
  // Provide them via env vars or leave empty and update them via the admin UI later.
  const config = {
    clientId: process.env.GOOGLE_ANALYTICS_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET ?? '',
  };

  // Path to the compiled CLI binary, relative to the webapp root.
  // Adjust this path if you use a different deploy layout.
  const binaryUrl = '../../integrations/google-analytics/bin/index.js';

  // Frontend bundle URL (served statically or from the package).
  const frontendUrl = '../../integrations/google-analytics/dist/frontend.js';

  try {
    await client.connect();

    const result = await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2"
        ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "frontendUrl", "updatedAt", "createdAt")
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET
        "slug"        = EXCLUDED."slug",
        "description" = EXCLUDED."description",
        "icon"        = EXCLUDED."icon",
        "spec"        = EXCLUDED."spec",
        "config"      = EXCLUDED."config",
        "version"     = EXCLUDED."version",
        "url"         = EXCLUDED."url",
        "frontendUrl" = EXCLUDED."frontendUrl",
        "updatedAt"   = NOW()
      RETURNING id, name, slug, version;
      `,
      [
        INTEGRATION_NAME,
        INTEGRATION_SLUG,
        spec.description,
        INTEGRATION_SLUG,                 // icon key matches ICON_MAPPING
        JSON.stringify(spec),
        JSON.stringify(config),
        INTEGRATION_VERSION,
        binaryUrl,
        frontendUrl,
      ]
    );

    const row = result.rows[0];
    console.log(`Google Analytics integration registered successfully:`);
    console.log(`  id:      ${row.id}`);
    console.log(`  slug:    ${row.slug}`);
    console.log(`  version: ${row.version}`);

    if (!config.clientId || !config.clientSecret) {
      console.warn(
        '\nWarning: GOOGLE_ANALYTICS_CLIENT_ID / GOOGLE_ANALYTICS_CLIENT_SECRET are not set.\n' +
          'Update the `config` column in IntegrationDefinitionV2 with your OAuth credentials before users connect.'
      );
    }
  } catch (error) {
    console.error('Error registering Google Analytics integration:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
