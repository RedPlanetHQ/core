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
    name: "Codeberg",
    key: "codeberg",
    description: "Manage your repositories and issues on Codeberg.org, a community-driven git hosting.",
    icon: "codeberg",
    schedule: {
      frequency: "*/15 * * * *"
    },
    mcp: {
      type: "cli"
    },
    auth: {
      OAuth2: {
        token_url: "https://codeberg.org/login/oauth/access_token",
        authorization_url: "https://codeberg.org/login/oauth/authorize",
        scopes: [
          "repo",
          "user"
        ],
        scope_separator: ","
      }
    }
  };

  try {
    await client.connect();
    
    const integration = await client.query(`
      INSERT INTO core."IntegrationDefinitionV2" ("id", "name", "slug", "description", "icon", "spec", "config", "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Codeberg', 'codeberg', 'Manage your repositories and issues on Codeberg.org', 'codeberg', $1, $2, '0.1.0', $3, NOW(), NOW())
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
    `, [
      JSON.stringify(spec), 
      JSON.stringify({
        clientId: process.env.CODEBERG_CLIENT_ID,
        clientSecret: process.env.CODEBERG_CLIENT_SECRET,
      }),
      "../../integrations/codeberg/bin/index.cjs"
    ]);
    console.log("Codeberg integration registered successfully in the database.");
  } catch (error) {
    console.error("Error registering Codeberg integration:", error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);