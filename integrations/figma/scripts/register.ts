import pg from 'pg';

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET environment variables are required');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  const spec = {
    name: 'Figma',
    key: 'figma',
    description:
      'Connect your Figma workspace to track file updates, comments, version history, and design activity in CORE.',
    icon: 'figma',
    schedule: {
      frequency: '*/15 * * * *',
    },
    mcp: {
      type: 'cli',
    },
    auth: {
      OAuth2: {
        token_url: 'https://www.figma.com/api/oauth/token',
        authorization_url: 'https://www.figma.com/oauth',
        scopes: [
          'file_content:read',
          'file_comments:read',
          'file_comments:write',
          'file_dev_resources:read',
          'webhooks:write',
        ],
        scope_separator: ',',
        fields: [
          {
            name: 'access_token',
            label: 'Access Token',
            placeholder: '',
            description: 'OAuth2 access token issued by Figma after authorization.',
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
      VALUES (gen_random_uuid(), 'Figma', 'figma', $4, 'figma', $1, $2, '0.1.0', $3, NOW(), NOW())
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
        JSON.stringify({ clientId, clientSecret }),
        '../../integrations/figma/bin/index.js',
        spec.description,
      ],
    );

    console.log('Figma integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Figma integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
