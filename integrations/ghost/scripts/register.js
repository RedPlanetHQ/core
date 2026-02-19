/**
 * Ghost Blog Integration Registration Script
 *
 * Upserts the Ghost integration definition into IntegrationDefinitionV2.
 * Run from the repo root with Node 18+:
 *
 *   node integrations/ghost/scripts/register.js
 *
 * Requires DATABASE_URL and DIRECT_URL env vars (or a .env in the repo root).
 */

import { PrismaClient } from '@core/database';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

const binPath = resolve(__dirname, '..', 'bin', 'index.cjs');

const GHOST_INTEGRATION = {
  name: 'Ghost Blog',
  slug: 'ghost',
  description:
    'Connect your Ghost blog to manage posts, pages, tags, and members. Create and publish content directly from your workspace.',
  icon: 'ghost',
  version: '0.1.0',
  url: binPath,
  spec: {
    name: 'Ghost Blog',
    key: 'ghost',
    description:
      'Connect your Ghost blog to manage posts, pages, tags, and members.',
    icon: 'ghost',
    mcp: { type: 'cli' },
    auth: {
      api_key: {
        fields: [
          {
            name: 'ghost_url',
            label: 'Ghost Blog URL',
            placeholder: 'https://myblog.ghost.io',
            description: 'Your Ghost blog URL without a trailing slash.',
          },
          {
            name: 'admin_api_key',
            label: 'Admin API Key',
            placeholder: 'your-key-id:your-secret',
            description:
              'Found in Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key.',
          },
        ],
      },
    },
  },
};

async function main() {
  console.log('Registering Ghost Blog integration...');
  console.log(`Binary path: ${binPath}`);

  const result = await prisma.integrationDefinitionV2.upsert({
    where: { name: GHOST_INTEGRATION.name },
    update: {
      slug: GHOST_INTEGRATION.slug,
      description: GHOST_INTEGRATION.description,
      icon: GHOST_INTEGRATION.icon,
      version: GHOST_INTEGRATION.version,
      url: GHOST_INTEGRATION.url,
      spec: GHOST_INTEGRATION.spec,
    },
    create: {
      name: GHOST_INTEGRATION.name,
      slug: GHOST_INTEGRATION.slug,
      description: GHOST_INTEGRATION.description,
      icon: GHOST_INTEGRATION.icon,
      version: GHOST_INTEGRATION.version,
      url: GHOST_INTEGRATION.url,
      spec: GHOST_INTEGRATION.spec,
    },
  });

  console.log(`✓ Ghost integration registered with ID: ${result.id}`);
  console.log(`  URL: ${result.url}`);
}

main()
  .catch((e) => {
    console.error('Registration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
