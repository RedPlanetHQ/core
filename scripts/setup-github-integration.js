#!/usr/bin/env node
/**
 * Setup script for GitHub integration
 *
 * This script registers the GitHub integration in the database.
 *
 * Usage:
 *   GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy node scripts/setup-github-integration.js
 *
 * Or add to .env:
 *   GITHUB_CLIENT_ID=your_client_id
 *   GITHUB_CLIENT_SECRET=your_client_secret
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setupGitHubIntegration() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set');
    console.error('');
    console.error('Get these from: https://github.com/settings/developers');
    console.error('');
    console.error('Usage:');
    console.error('  GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy node scripts/setup-github-integration.js');
    process.exit(1);
  }

  try {
    const spec = {
      auth: {
        OAuth2: {
          token_url: 'https://github.com/login/oauth/access_token',
          authorization_url: 'https://github.com/login/oauth/authorize',
          client_id: clientId,
          client_secret: clientSecret,
          scopes: [
            'user',
            'public_repo',
            'repo',
            'notifications',
            'gist',
            'read:org',
            'repo_hooks'
          ],
          scope_separator: ' '  // GitHub uses space separator
        }
      },
      sync: {
        frequency: '*/15 * * * *', // Every 15 minutes
        enabled: true
      },
      // Path to the built integration CLI (inside container)
      integration_path: '/core/integrations/github/bin/index.cjs'
    };

    const integration = await prisma.integrationDefinitionV2.upsert({
      where: { name: 'GitHub' },
      update: {
        spec: spec,
        version: '1.0.0',
        updatedAt: new Date()
      },
      create: {
        name: 'GitHub',
        slug: 'github',
        description: 'Track GitHub activities including PRs, issues, comments, and notifications',
        icon: 'github',
        spec: spec,
        version: '1.0.0',
        url: 'https://github.com',
        workspaceId: null // Global integration
      }
    });

    console.log('✅ GitHub integration registered successfully!');
    console.log('');
    console.log('Integration Details:');
    console.log('  ID:', integration.id);
    console.log('  Name:', integration.name);
    console.log('  Slug:', integration.slug);
    console.log('  Version:', integration.version);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Go to http://localhost:3033/home/integrations');
    console.log('  2. Click on GitHub integration');
    console.log('  3. Click "Connect" to authorize via OAuth');
    console.log('');

  } catch (error) {
    console.error('❌ Error registering GitHub integration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupGitHubIntegration();
