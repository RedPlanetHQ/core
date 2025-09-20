# Slack Integration

Real-time Slack workspace activity tracking via webhooks for CORE memory system.

## Overview

The Slack integration captures your workspace communications, reactions, and collaborations through real-time webhooks and API access, creating a comprehensive memory layer of your team interactions and project discussions.

## Features

### 💬 Message Tracking
- **Channel Messages**: Monitor messages in channels you're active in
- **Direct Messages**: Track DM conversations and threads
- **Thread Participation**: Capture threaded discussions and replies
- **Mentions**: Track when you're @mentioned in conversations

### 🎯 Team Collaboration
- **Reactions**: Track emoji reactions on messages
- **Stars**: Monitor starred messages and important content
- **Channel Management**: Track channel joins, leaves, and participation
- **Team Interactions**: Capture cross-team communication patterns

### 🔗 MCP Integration
- **Stdio MCP Server**: Uses dedicated Slack MCP server for enhanced functionality
- **Message Tools**: Supports message creation and interaction tools
- **Real-time Events**: Webhook-based instant event delivery

## Authentication

Uses **OAuth2** with comprehensive scopes:
- `stars:read` & `stars:write` - Access starred content
- `team:read` & `users:read` - Team and user information
- `channels:read` & `channels:history` - Public channel access
- `groups:read` - Private channel access (if member)
- `im:read` & `im:history` - Direct message access
- `mpim:read`, `mpim:write` & `mpim:history` - Multi-party DM access
- `chat:write` - Message sending capabilities
- `reactions:read` & `reactions:write` - Reaction access
- `users.profile:read` - User profile information

## Configuration

### Data Collection Method
- **Real-time Webhooks**: Instant event delivery (unlike scheduled sync)
- **Event Streaming**: Continuous monitoring of workspace activity
- **Context-aware**: Captures conversation context and threading
- **User-scoped**: Only accesses data you have permission to see

### MCP Server Setup
```json
{
  "type": "stdio",
  "url": "https://integrations.heysol.ai/slack/mcp/slack-mcp-server",
  "env": {
    "SLACK_MCP_XOXP_TOKEN": "${config:access_token}",
    "SLACK_MCP_ADD_MESSAGE_TOOL": true
  }
}
```

## Event Types

### Message Activities
```
{username} sent message in #{channel}: {message}
{username} replied to thread in #{channel}: {reply}
{username} sent DM to {recipient}: {message}
{username} mentioned {target} in #{channel}: {message}
```

### Interaction Events
```
{username} reacted with :{emoji}: to message in #{channel}
{username} starred message in #{channel}: {message}
{username} joined channel #{channel}
{username} left channel #{channel}
```

### Team Collaboration
```
{username} created channel #{channel}
{username} archived channel #{channel}
{username} updated channel #{channel} topic: {topic}
Team discussion started in #{channel} about {topic}
```


## Webhook Event Processing

The integration processes various Slack webhook events:
- **Message Events**: New messages, edits, deletions
- **Reaction Events**: Emoji reactions added/removed
- **Channel Events**: Channel creation, archiving, topic changes
- **User Events**: Joins, leaves, status changes
- **Thread Events**: Threaded conversation activity

### Event Processing Flow
1. **Webhook Receipt**: Real-time event from Slack
2. **Event Validation**: Verify event authenticity and permissions
3. **Context Enrichment**: Fetch additional message/user/channel context
4. **Activity Creation**: Generate structured activity event
5. **Knowledge Graph**: Send to CORE for entity extraction

## Knowledge Graph Integration

Events create rich relationships in CORE's knowledge graph:
- **Entities**: Users, channels, messages, teams, workspaces
- **Relationships**: Sent, replied, mentioned, reacted, joined, starred
- **Attributes**: Timestamps, message content, reaction types, channel topics
- **Context**: Workspace culture, team dynamics, project discussions

## Privacy & Security

### Data Access
- **User-scoped Permissions**: Only data you have access to
- **Workspace Boundaries**: Confined to connected workspace
- **Message Content**: Captures text for context (respects channel permissions)
- **Sensitive Data**: Follows Slack's data handling guidelines

### Security Measures
- **OAuth2 Flow**: Secure token-based authentication
- **Webhook Verification**: Validates event authenticity
- **Rate Limiting**: Respects Slack API limits
- **Error Handling**: Graceful handling of permission errors

## Usage

The integration operates through real-time webhooks:

1. **Webhook Setup**: Configure Slack webhook endpoints
2. **Event Reception**: Receive real-time workspace events
3. **Context Fetching**: Enrich events with additional API data
4. **Activity Generation**: Create structured activity messages
5. **Entity Processing**: Extract users, channels, topics for knowledge graph
6. **Memory Integration**: Store in CORE for intelligent recall


## API Reference

- **Slack Web API**: https://api.slack.com/web
- **Events API**: https://api.slack.com/events-api
- **OAuth2 Guide**: https://api.slack.com/authentication/oauth-v2
- **Webhook Events**: https://api.slack.com/events
- **Rate Limiting**: https://api.slack.com/docs/rate-limits