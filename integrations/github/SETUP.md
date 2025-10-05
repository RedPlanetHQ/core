# GitHub Integration Setup Guide

## Prerequisites

1. A GitHub account
2. CORE running locally or deployed
3. Access to create GitHub OAuth Apps

## Step 1: Create GitHub OAuth Application

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the application details:
   ```
   Application name: CORE Integration
   Homepage URL: http://localhost:3033  (or your APP_ORIGIN)
   Authorization callback URL: http://localhost:3033/api/v1/oauth/callback
   ```
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the **Client Secret**

## Step 2: Register Integration in CORE

### Option A: Using the Setup Script (Recommended)

```bash
# From the repository root
GITHUB_CLIENT_ID=your_client_id \
GITHUB_CLIENT_SECRET=your_client_secret \
tsx scripts/setup-github-integration.ts
```

### Option B: Add to Environment Variables

Add to your `.env` file:

```bash
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
```

Then run the setup script:

```bash
tsx scripts/setup-github-integration.ts
```

### Option C: Manual Database Insert

If the script doesn't work, you can manually insert the integration:

```sql
INSERT INTO "IntegrationDefinitionV2" (
  id,
  name,
  slug,
  description,
  icon,
  spec,
  version,
  url,
  "workspaceId",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid(),
  'GitHub',
  'github',
  'Track GitHub activities including PRs, issues, comments, and notifications',
  'github',
  '{
    "auth": {
      "OAuth2": {
        "token_url": "https://github.com/login/oauth/access_token",
        "authorization_url": "https://github.com/login/oauth/authorize",
        "client_id": "YOUR_GITHUB_CLIENT_ID",
        "client_secret": "YOUR_GITHUB_CLIENT_SECRET",
        "scopes": ["user", "public_repo", "repo", "notifications", "gist", "read:org", "repo_hooks"],
        "scope_separator": " "
      }
    },
    "sync": {
      "frequency": "*/15 * * * *",
      "enabled": true
    },
    "integration_path": "/home/jmagar/core/integrations/github/bin/index.cjs"
  }'::jsonb,
  '1.0.0',
  'https://github.com',
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  spec = EXCLUDED.spec,
  version = EXCLUDED.version,
  "updatedAt" = NOW();
```

## Step 3: Connect Your GitHub Account

1. Start your CORE application:
   ```bash
   pnpm dev
   ```

2. Navigate to integrations:
   ```
   http://localhost:3033/home/integrations
   ```

3. Find the **GitHub** integration card

4. Click **"Connect"**

5. You'll be redirected to GitHub to authorize the application

6. Grant the requested permissions

7. You'll be redirected back to CORE with a success message

## Step 4: Verify the Integration

### Check Integration Account

The integration should now appear in your connected integrations. You can verify by:

1. Go to Settings → Integrations
2. You should see GitHub listed as connected
3. The integration will sync every 15 minutes

### What Gets Synced

The GitHub integration automatically syncs:

- ✅ **Notifications** (assignments, mentions, review requests, etc.)
- ✅ **Pull Requests** (created, commented, reviewed)
- ✅ **Issues** (created, assigned, commented)
- ✅ **Comments** on PRs and issues you're involved in
- ✅ **Repository activities** from watched repos

All activities are stored in your CORE memory graph and can be queried via MCP.

## Step 5: Use with MCP Clients

Once connected, you can access your GitHub data through MCP-enabled tools like Claude Desktop, Cursor, etc.

### Example MCP Configuration

Add to your MCP client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "core": {
      "command": "npx",
      "args": ["-y", "@redplanethq/init@latest", "mcp"],
      "env": {
        "CORE_API_KEY": "your_core_api_key"
      }
    }
  }
}
```

Then ask questions like:
- "What GitHub PRs am I reviewing?"
- "Show me my recent GitHub activity"
- "What issues are assigned to me?"

## Troubleshooting

### OAuth Redirect Not Working

Make sure your GitHub OAuth App callback URL matches exactly:
```
http://localhost:3033/api/v1/oauth/callback
```

If you're using a different domain or port, update it in GitHub OAuth settings.

### Integration Not Syncing

1. Check the integration account is active:
   ```sql
   SELECT * FROM "IntegrationAccount" WHERE "integrationDefinitionId" IN (
     SELECT id FROM "IntegrationDefinitionV2" WHERE slug = 'github'
   );
   ```

2. Check if there are any errors in the logs

3. Verify the cron job is running (should run every 15 minutes)

### No Activities Appearing

1. Make sure you have GitHub notifications
2. Check your GitHub activity in the last 24 hours
3. The sync only pulls activities from the last sync time

### Manual Trigger Sync

To manually trigger a sync for testing:

```typescript
// In your app or a script
import { runIntegrationTrigger } from '~/services/integration.server';
import { IntegrationEventType } from '@core/types';

await runIntegrationTrigger(
  integrationDefinition,
  {
    event: IntegrationEventType.SYNC,
    config: integrationAccount.integrationConfiguration,
    state: integrationAccount.settings
  },
  userId,
  workspaceId
);
```

## How It Works

### Architecture

```
┌─────────────┐     OAuth Flow      ┌──────────────┐
│   GitHub    │◄───────────────────►│  CORE OAuth  │
│   OAuth     │                      │  Callback    │
└─────────────┘                      └──────────────┘
                                             │
                                             ▼
                                     ┌──────────────────┐
                                     │ Integration      │
                                     │ Account Created  │
                                     └──────────────────┘
                                             │
                                             ▼
                                     ┌──────────────────┐
                                     │  Background Job  │
                                     │  (Every 15 min)  │
                                     └──────────────────┘
                                             │
                                             ▼
                                     ┌──────────────────┐
                                     │  Fetch GitHub    │
                                     │  Activities      │
                                     └──────────────────┘
                                             │
                                             ▼
                                     ┌──────────────────┐
                                     │  Store in CORE   │
                                     │  Memory Graph    │
                                     └──────────────────┘
```

### Sync Process

1. **OAuth Authentication**: User authorizes CORE to access their GitHub account
2. **Account Creation**: Integration account is created with access tokens
3. **Background Sync**: Every 15 minutes, the integration:
   - Fetches notifications since last sync
   - Fetches user events (PRs, issues, comments)
   - Transforms them into CORE activities
   - Stores in the memory graph
4. **MCP Access**: Activities are queryable through MCP tools

### Data Flow

```typescript
GitHub API → Integration Package → CORE Activities → Memory Graph → MCP Tools
```

## Additional Resources

- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps)
- [CORE Documentation](https://docs.heysol.ai)
- [Integration Source Code](./src/)
