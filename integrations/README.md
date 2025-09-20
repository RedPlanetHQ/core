# CORE Integrations

Integrations connect external services to CORE's knowledge graph, automatically capturing activities and context to build your persistent memory layer.

## Available Integrations

### 🐙 [GitHub](./github/README.md)
Tracks your GitHub activities and notifications, including PRs, issues, comments, and repository events.

**Features:**
- Pull request creation, comments, and reviews
- Issue tracking and assignments
- Notification processing (mentions, reviews, assignments)
- Repository watching and subscriptions
- Team mentions and state changes

### 📐 [Linear](./linear/README.md)
Project management and issue tracking integration.

**Features:**
- Issue creation and updates
- Project milestone tracking
- Team assignments and workflows

### 💬 [Slack](./slack/README.md)
Workspace communication and activity tracking.

**Features:**
- Channel message monitoring
- Direct message tracking
- Thread participation

## How Integrations Work

1. **Authentication**: OAuth2 setup with service-specific scopes
2. **Data Collection**: Either scheduled sync (every 5 minutes) or real-time webhooks when supported
3. **Event Processing**: Converting activities into structured events
4. **Entity Extraction**: Identifying users, projects, repositories, etc.
5. **Knowledge Graph Ingestion**: Creating episodes and relationships in CORE

## Common Features

### 🔄 Data Collection Methods
- **Scheduled Sync**: Periodic API polling (every 5 minutes) for services like GitHub and Linear
- **Real-time Webhooks**: Instant event delivery for services that support personal webhooks (like Slack)
- **Incremental Updates**: Only fetch new activities since last sync
- **Deduplication**: Prevent duplicate events from being processed
- **Rate Limiting**: Respect API limits with intelligent backoff
- **Error Handling**: Graceful degradation on service outages

### 📊 Activity Tracking
- **User Actions**: What you created, commented, or modified
- **Mentions**: When others reference you in discussions
- **Assignments**: Tasks or issues assigned to you
- **State Changes**: Status updates on projects you follow

### 🧠 Knowledge Graph Integration
- **Entities**: People, projects, repositories, issues, organizations
- **Relationships**: Created, commented, assigned, mentioned, collaborated
- **Temporal Context**: When events occurred and their sequence
- **Cross-Integration Links**: Connections between different services

## Event Format

All integrations generate events in a consistent format for knowledge graph ingestion:

```typescript
{
  text: "{actor} {action} {object} in {context}: {details}",
  sourceURL: "https://service.com/link/to/event",
  timestamp: "2025-01-20T10:30:00Z",
  integration: "github" | "linear" | "slack"
}
```

### Example Events
```
john_doe created PR #123 in facebook/react: Fix memory leak in hooks
alice_smith mentioned manoj_k in linear/project issue #456: Can you review?
team mentioned manoj_k's team in slack/engineering: Weekly standup reminder
```

## Configuration

Each integration requires:

1. **OAuth Setup**: Service-specific authentication
2. **Scope Configuration**: Permissions for data access
3. **Sync Schedule**: How frequently to check for updates
4. **Filtering Rules**: What events to include/exclude

## Development Guide

### Adding New Integrations

1. **Create Integration Directory**
   ```bash
   mkdir integrations/{service-name}
   cd integrations/{service-name}
   ```

2. **Required Files**
   ```
   src/
   ├── index.ts          # Main entry point
   ├── schedule.ts       # Sync logic and event processing
   ├── utils.ts          # API utilities
   ├── account-create.ts # Authentication setup
   └── README.md         # Integration documentation
   ```

3. **Core Implementation**
   - Extend `IntegrationCLI` class
   - Implement OAuth2 authentication
   - Define sync schedule and event processing
   - Handle API rate limits and errors

4. **Event Processing**
   - Convert service events to standard format
   - Extract entities and relationships
   - Ensure consistent naming and structure
   - Add deduplication logic