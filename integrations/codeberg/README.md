# Codeberg Integration

Manage your repositories and issues on Codeberg.org, a community-driven git hosting.

## Overview

The Codeberg integration allows you to interact with your Codeberg repositories, issues, and other resources directly through CORE's MCP interface.

## Features

### 🔗 MCP Tools
- **Repositories**: List your repositories, get repository details.
- **Issues**: List issues, get issue details, create new issues.

## Authentication

Uses OAuth2 with the following scopes:
- `user` - Access user profile information
- `repo` - Access repositories

## Configuration

### Schedule
- **Frequency**: Every 15 minutes (`*/15 * * * *`)

## Usage

Once connected, you can use AI agents to perform actions like:
- "List my Codeberg repositories"
- "Create an issue in my-repo titled 'Bug fix'"
- "Show me the latest issues in organization/repo"
