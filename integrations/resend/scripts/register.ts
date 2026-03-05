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
    name: 'Resend',
    key: 'resend',
    description:
      'Connect your Resend account to send emails, manage audiences, contacts, domains, templates, and more.',
    icon: 'resend',
    mcp: {
      type: 'cli',
    },
    auth: {
      api_key: {
        fields: [
          {
            name: 'api_key',
            label: 'API Key',
            placeholder: 're_xxxxxxxxxxxxxxxxxxxx',
            description:
              'Your Resend API key. Found in Resend Dashboard → API Keys → Create API Key.',
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
      VALUES (gen_random_uuid(), 'Resend', 'resend', 'Connect your Resend account to send emails, manage audiences, contacts, domains, templates, and more.', 'resend', $1, $2, '0.1.0', $3, NOW(), NOW())
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
      [JSON.stringify(spec), JSON.stringify({}), '../../integrations/resend/bin/index.cjs']
    );

    console.log('Resend integration registered successfully in the database.');
  } catch (error) {
    console.error('Error registering Resend integration:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
