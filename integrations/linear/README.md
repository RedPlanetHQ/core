# Linear Integration

Automatic Linear activity tracking and issue management integration for CORE memory system.

## Overview

The Linear integration captures your Linear project activities, issue interactions, and team collaborations, processing them into structured events for CORE's knowledge graph to build intelligent context around your project management workflow.

## Features

### 📊 Issue Tracking
- **Issue Creation**: Track new issues you create across projects
- **Issue Updates**: Monitor changes to issue status, priority, and assignments
- **Comments**: Capture comments on issues you're involved with
- **Assignments**: Track issues assigned to you or by you

### 🎯 Project Management
- **Project Milestones**: Monitor progress on project goals and deadlines
- **Team Workflows**: Track team assignments and collaboration patterns
- **Status Changes**: Issue state transitions (todo, in progress, done, etc.)
- **Priority Updates**: Changes to issue priority and urgency

### 🔗 MCP Integration
- Direct Linear MCP server integration at `https://mcp.linear.app/mcp`
- Provides enhanced functionality for Linear operations
- Seamless integration with Linear's GraphQL API

## Authentication

Uses **API Key** authentication:
- Requires Linear Personal API Token
- Full access to your Linear workspace data
- Secure token-based authentication

## Configuration

### Schedule
- **Frequency**: Every 5 minutes (`*/5 * * * *`)
- **Sync Types**: Issues, comments, and user actions
- **Incremental Sync**: Tracks last sync timestamps for each data type

### Data Processing
- **GraphQL API**: Uses Linear's GraphQL endpoint for efficient data fetching
- **User Context**: Fetches your user information for proper attribution
- **Temporal Tracking**: Maintains chronological order of activities
- **Deduplication**: Prevents duplicate event processing

## Event Types

### Issue Management
```
{username} created issue in {project}: {title}
{username} updated issue #{number} in {project}: {title}
{username} commented on issue #{number} in {project}: {comment}
{username} assigned issue #{number} to {assignee} in {project}: {title}
Issue #{number} status changed to {status} in {project}: {title}
Issue #{number} priority changed to {priority} in {project}: {title}
```

### Project Activities
```
{username} created milestone in {project}: {milestone}
{username} completed milestone in {project}: {milestone}
Team assignment updated for issue #{number} in {project}: {title}
```

## Knowledge Graph Integration

Events are processed into CORE's knowledge graph with:
- **Entities**: Users, projects, issues, milestones, teams
- **Relationships**: Created, assigned, commented, completed, collaborated
- **Attributes**: Issue numbers, status, priority, timestamps
- **Context**: Project associations, team memberships, workflow stages

## Sync Management

The integration maintains separate sync timestamps for:
- **Issues**: `lastIssuesSync` - New and updated issues
- **Comments**: `lastCommentsSync` - Comment activity
- **User Actions**: `lastUserActionsSync` - Specific user-initiated activities

This ensures comprehensive coverage without missing activities across different Linear data types.

## Rate Limits & Performance

- **GraphQL Efficiency**: Single requests fetch related data
- **Pagination Support**: Handles large datasets with cursor-based pagination
- **API Rate Limits**: Respects Linear's API limits with intelligent backoff
- **Error Handling**: Graceful degradation on API failures
- **Incremental Updates**: Only fetches changes since last sync

## Usage

The integration runs automatically once configured with your Linear API key:

1. **Fetch User Context**: Get your Linear user information
2. **Query Recent Activities**: Fetch issues, comments, and actions since last sync
3. **Process Events**: Convert Linear data into standardized event format
4. **Extract Entities**: Identify users, projects, issues, and relationships
5. **Create Episodes**: Generate memory episodes for knowledge graph ingestion
6. **Update Sync State**: Save timestamps for next incremental sync

## API Reference

- **Linear GraphQL API**: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
- **Authentication**: https://developers.linear.app/docs/graphql/working-with-the-graphql-api#authentication
- **Rate Limiting**: https://developers.linear.app/docs/graphql/working-with-the-graphql-api#rate-limiting