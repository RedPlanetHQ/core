import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const url = "../../integrations/postman/bin/index.js";

  const spec = {
    name: "Postman",
    key: "postman",
    description:
      "Sync your Postman workspaces, collections, environments, APIs, monitors, and mocks. Lets the agent inspect and edit them through MCP.",
    icon: "postman",
    mcp: { type: "cli" },
    schedule: { frequency: "*/15 * * * *" },
    auth: {
      api_key: {
        fields: [
          {
            name: "api_key",
            label: "Postman API Key",
            placeholder: "PMAK-xxxxxxxxxxxxxxxxxxxxxxxxx",
            description: "Generate this in Postman → Settings → API Keys → Generate API Key.",
          },
        ],
      },
    },
  };

  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(
      `
      INSERT INTO core."IntegrationDefinitionV2"
        ("id", "name", "slug", "description", "icon", "spec", "config",
         "version", "url", "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET
        "slug"        = EXCLUDED."slug",
        "description" = EXCLUDED."description",
        "icon"        = EXCLUDED."icon",
        "spec"        = EXCLUDED."spec",
        "config"      = EXCLUDED."config",
        "version"     = EXCLUDED."version",
        "url"         = EXCLUDED."url",
        "updatedAt"   = NOW()
      RETURNING id;
      `,
      [
        spec.name,
        spec.key,
        spec.description,
        spec.icon,
        JSON.stringify(spec),
        JSON.stringify({}),
        "1.0.0",
        url,
      ]
    );
    console.log(`Registered integration "${spec.name}" successfully.`);
  } catch (e) {
    console.error("Registration failed:", e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
