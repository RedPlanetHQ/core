import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const linkedin = await prisma.integrationDefinitionV2.upsert({
    where: { name: 'LinkedIn' },
    update: {
      slug: 'linkedin',
      description: 'Connect your LinkedIn professional network with CORE. Sync activities and post updates.',
      icon: 'linkedin',
      spec: {
        key: 'linkedin',
        name: 'LinkedIn',
        icon: 'linkedin',
        description: 'Connect your LinkedIn professional network with CORE. Sync activities and post updates.',
        auth: {
          OAuth2: {
            scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
            token_url: 'https://www.linkedin.com/oauth/v2/accessToken',
            scope_identifier: 'scope',
            scope_separator: ' ',
            authorization_url: 'https://www.linkedin.com/oauth/v2/authorization'
          }
        },
        mcp: {
          type: 'cli'
        },
        schedule: {
          frequency: '*/15 * * * *'
        }
      },
      url: './integrations/linkedin/bin/index.cjs'
    },
    create: {
      name: 'LinkedIn',
      slug: 'linkedin',
      description: 'Connect your LinkedIn professional network with CORE. Sync activities and post updates.',
      icon: 'linkedin',
      spec: {
        key: 'linkedin',
        name: 'LinkedIn',
        icon: 'linkedin',
        description: 'Connect your LinkedIn professional network with CORE. Sync activities and post updates.',
        auth: {
          OAuth2: {
            scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
            token_url: 'https://www.linkedin.com/oauth/v2/accessToken',
            scope_identifier: 'scope',
            scope_separator: ' ',
            authorization_url: 'https://www.linkedin.com/oauth/v2/authorization'
          }
        },
        mcp: {
          type: 'cli'
        },
        schedule: {
          frequency: '*/15 * * * *'
        }
      },
      url: './integrations/linkedin/bin/index.cjs'
    }
  });
  console.log('LinkedIn integration added/updated:', linkedin);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
