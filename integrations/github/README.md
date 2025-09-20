# GitHub Integration

Automatic GitHub activity tracking and notification processing for CORE memory system.

## Overview

The GitHub integration captures your GitHub activities and notifications, processes them into structured events, and ingests them into CORE's knowledge graph for intelligent memory and context building.

## Features

### 📊 Activity Tracking
- **Pull Requests**: Created, commented, reviewed
- **Issues**: Created, assigned, commented, self-assigned
- **Comments**: PR comments, issue comments
- **Repository Events**: Watching, subscribing, state changes

### 🔔 Notification Processing
- **Assignments**: Issues and PRs assigned to you
- **Reviews**: PR review requests
- **Mentions**: @mentions in discussions
- **Comments**: New comments on your content
- **State Changes**: PR/issue open/close/merge events
- **Subscriptions**: Updates on watched repositories
- **Team Mentions**: Team @mentions

### 🔗 MCP Integration
- Uses GitHub Copilot MCP server for extended functionality
- Provides seamless integration with GitHub's AI tools

## Authentication

Uses OAuth2 with the following scopes:
- `user` - Access user profile information
- `public_repo` - Access public repositories
- `repo` - Access private repositories
- `notifications` - Read notifications
- `gist` - Access gists
- `read:org` - Read organization membership
- `repo_hooks` - Manage repository webhooks

## Configuration

### Schedule
- **Frequency**: Every 5 minutes (`*/5 * * * *`)
- **Sync Window**: 24 hours (configurable)
- **Rate Limiting**: Built-in GitHub API rate limit handling

### Data Processing
- **Deduplication**: Filters out duplicate events using timestamps
- **Entity Extraction**: Extracts users, repositories, PR/issue numbers
- **Relationship Mapping**: Creates connections between entities
- **Temporal Tracking**: Maintains event chronology

## Event Types

### User Activities
```
{username} created PR #{number} in {repo}: {title}
{username} created issue #{number} in {repo}: {title}
{username} commented on PR #{number} in {repo}: {title}
{username} commented on issue #{number} in {repo}: {title}
{username} assigned themselves to issue #{number} in {repo}: {title}
```

### Notifications
```
Issue #{number} assigned to {username} in {repo}: {title}
{actor} commented on {username}'s PR #{number} in {repo}: {body}
{actor} mentioned {username} in {repo} issue #{number}: {body}
{username} requested to review PR #{number} in {repo}: {title}
{actor} changed PR #{number} state to {state} in {repo}: {title}
```