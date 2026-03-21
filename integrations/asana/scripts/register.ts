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
    name: 'Asana',
    key: 'asana',
    description:
      'Connect your Asana workspace to CORE. List workspaces, projects, and tasks, create tasks, and add comments — all from your workspace.',
    icon: 'asana',
    auth: {
      OAuth2: {
        authorization_url: 'https://app.asana.com/-/oauth_authorize',
        token_url: 'https://app.asana.com/-/oauth_token',
        default_scopes: ['default'],
        scope_separator: ' ',
      },
    },
    mcp: {
      type: 'cli',
    },
  };

  try {
    await client.connect();

    const result = await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2" (
        "id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt"
      )
      VALUES (
        gen_random_uuid(),
        'Asana',
        'asana',
        $1,
        'asana',
        $2,
        $3,
        '0.1.0',
        $4,
        NOW(),
        NOW()
      )
      ON CONFLICT (name) DO UPDATE SET
        "slug"        = EXCLUDED."slug",
        "description" = EXCLUDED."description",
        "icon"        = EXCLUDED."icon",
        "spec"        = EXCLUDED."spec",
        "config"      = EXCLUDED."config",
        "version"     = EXCLUDED."version",
        "url"         = EXCLUDED."url",
        "updatedAt"   = NOW()
      RETURNING *;
      `,
      [
        spec.description,
        JSON.stringify(spec),
        JSON.stringify({}),
        '../../integrations/asana/bin/index.cjs',
      ],
    );

    console.log('Asana integration registered successfully:', result.rows[0].id);
  } catch (error) {
    console.error('Error registering Asana integration:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
