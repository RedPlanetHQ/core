# Attio Integration

Connect your Attio CRM workspace to CORE. Syncs contacts, companies, notes, and CRM activity into your memory layer, and exposes tools for managing records, tasks, and lists.

## Setup

1. Log in to [Attio](https://app.attio.com)
2. Go to **Settings → API Keys**
3. Create a new access token with the required scopes (read/write access to People, Companies, Notes, Tasks, Lists)
4. Copy the token and paste it into the CORE integration setup

## Authentication

Uses Attio Access Token (Bearer token). No OAuth required.

## Scheduled Sync

Runs every 15 minutes and syncs:

- Recently updated **people** (contacts)
- Recently updated **companies**
- Recently created **notes**

## MCP Tools

### People (Contacts)

| Tool | Description |
|------|-------------|
| `create_person` | Create a new contact record |
| `get_person` | Get a contact by record ID |
| `update_person` | Update contact fields |
| `search_people` | Search contacts by name or email |
| `delete_person` | Delete a contact record |

### Companies

| Tool | Description |
|------|-------------|
| `create_company` | Create a new company record |
| `get_company` | Get a company by record ID |
| `update_company` | Update company fields |
| `search_companies` | Search companies by name or domain |
| `delete_company` | Delete a company record |

### Notes

| Tool | Description |
|------|-------------|
| `create_note` | Create a note on a person or company |
| `get_note` | Get a note by ID |
| `list_notes` | List notes, optionally filtered by record |
| `delete_note` | Delete a note |

### Tasks

| Tool | Description |
|------|-------------|
| `create_task` | Create a task, optionally linked to records |
| `get_task` | Get a task by ID |
| `update_task` | Update a task (e.g. mark complete) |
| `delete_task` | Delete a task |
| `list_tasks` | List tasks, optionally filtered by status |

### Lists

| Tool | Description |
|------|-------------|
| `list_lists` | List all Attio lists/pipelines |
| `get_list` | Get a specific list by ID |
| `list_entries` | List entries within a list |

## Resources

- [Attio Developer Docs](https://docs.attio.com/)
- [Generate an API Key](https://attio.com/help/apps/other-apps/generating-an-api-key)
