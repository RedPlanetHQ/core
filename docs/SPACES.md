# Spaces

## Overview About Spaces

Spaces allow you to organize your CORE memory into distinct, project-specific contexts. Think of Spaces as smart folders that automatically group related memories, generate living summaries, and help you maintain focused context for different areas of your work and life.

Each Space:

- **Groups related memories** (episodes) around a specific topic or project
- **Automatically generates and maintains a summary** of its contents
- **Enables scoped search** within that specific context
- **Uses AI to automatically assign** relevant memories

Every user gets a default **Profile Space** that stores personal information and preferences.

## How to Create a Space in CORE

### Via Web Dashboard

1. Navigate to the **Spaces section** in your CORE dashboard
2. Click **"New Space"** button
3. Enter a **Name** for your Space (required, max 100 characters)
4. Add an optional **Rule** (description) to guide what should be stored in this Space
5. Click **Create**

CORE will automatically analyze your recent memories and assign relevant ones to the new Space.

### Via API

You can also create Spaces programmatically using the CORE API:

```bash
curl -X POST https://core.heysol.ai/api/v1/spaces \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Core-Features",
    "description": "Feature discussions, design decisions, and implementation notes for CORE"
  }'
```

## Spaces Use Cases

### Project-Specific Memory

Organize memories by project or product area:

- **Core-Features**: Feature discussions, design decisions, implementation notes
- **Core-Business**: Business strategy, partnerships, GTM decisions
- **Reddit-Marketing**: Marketing campaigns, content strategy, community feedback

### Domain Separation

Keep different life domains organized:

- **Work**: Professional projects, meetings, decisions
- **Personal**: Personal goals, learnings, life context
- **Health**: Fitness tracking, meal preferences, wellness journey

### Client/Customer Organization

Maintain separate contexts for each client:

- **Client-Acme**: All Acme Corp discussions, requirements, deliverables
- **Client-TechCo**: TechCo project context, communication, decisions

### Topic-Based Knowledge Bases

Build domain-specific knowledge repositories:

- **Marketing**: Campaign ideas, content strategy, brand guidelines
- **Engineering**: Architecture decisions, technical debt, best practices
- **Product**: User feedback, feature requests, roadmap discussions

## Examples

### Example 1: Using Spaces with Claude Code

Configure in your `claude.md`:

```markdown
## Session Startup
- At the start of every session, check the Core-Features space for relevant context

## Memory Organization
- Store all feature discussions in Core-Features space
- Store marketing conversations in Reddit-Marketing space
```

### Example 2: Project-Based Organization

Create separate spaces for each project you're working on:

```
Engineering-Platform → Architecture, infrastructure, DevOps decisions
Mobile-App → iOS/Android development, UI/UX, app features
Data-Pipeline → ETL jobs, data models, analytics
```

When discussing the mobile app, CORE will automatically pull context from the Mobile-App space, keeping your conversation focused and relevant.

### Example 3: Client Management

For consultants or agencies managing multiple clients:

```
Client-StartupX → 
  - Weekly standup notes
  - Feature requirements
  - Budget discussions
  - Deliverables timeline

Client-EnterpriseY →
  - Enterprise architecture decisions
  - Compliance requirements
  - Integration specifications
```

Each space maintains isolated context, preventing information leakage between clients.

### Example 4: Personal Knowledge Management

Separate professional and personal contexts:

```
Work →
  - Sprint planning notes
  - Performance reviews
  - Team feedback
  - Technical learnings

Personal →
  - Book notes
  - Learning goals
  - Hobby projects
  - Life decisions

Health →
  - Workout routines
  - Meal preferences
  - Sleep patterns
  - Wellness goals
```

### Example 5: AI-Assisted Space Assignment

When you create a new Space with a clear description, CORE's AI automatically:

1. **Analyzes your description** to understand the space's purpose
2. **Reviews recent memories** (last 25 episodes by default)
3. **Assigns relevant memories** to the new Space
4. **Generates an initial summary** of the Space's contents

For example, creating a space named "Machine-Learning" with description "Research papers, model experiments, and ML architecture decisions" will automatically pull in relevant conversations about neural networks, training pipelines, and model evaluation.

## Best Practices

### Naming Conventions

- Use clear, descriptive names: `Core-Features` instead of `CF`
- Use hyphens for multi-word names: `Mobile-App` not `MobileApp`
- Keep names under 50 characters for better UI display

### Effective Descriptions

Good descriptions help AI assign memories correctly:

- ✅ **Good**: "All discussions about CORE's graph memory system, including design decisions and implementation details"
- ❌ **Too vague**: "Project stuff"
- ❌ **Too broad**: "Everything related to work"

### Space Organization

- **Start broad, then narrow**: Create general spaces first, then specialized ones as needed
- **Avoid overlap**: If two spaces frequently contain the same information, consider merging them
- **Regular review**: Periodically check Space summaries to ensure memories are assigned correctly

### Integration with MCP

Spaces work seamlessly with Model Context Protocol (MCP) tools. When querying your memory through MCP clients like Claude Desktop or Cursor, you can filter by Space to get context-specific results.

See the [MCP Integration Guide](https://docs.heysol.ai/providers/claude) for setup instructions.

## Advanced Features

### Space Summaries

Each Space automatically generates and maintains a summary of its contents. Summaries:

- Update as new memories are added
- Highlight key themes and patterns
- Surface important decisions and outcomes
- Provide quick context without reading all episodes

### Scoped Search

When searching within a Space, CORE:

- Only returns results from that Space's memories
- Ranks results based on Space-specific relevance
- Preserves temporal context within the Space

### Pattern Recognition

CORE identifies patterns within Spaces:

- Recurring themes and topics
- Common entities and relationships
- Temporal trends and changes
- Knowledge evolution over time

## API Reference

### Create Space

```
POST /api/v1/spaces
```

**Request Body:**
```json
{
  "name": "string (required, max 100 chars)",
  "description": "string (optional)"
}
```

### List Spaces

```
GET /api/v1/spaces
```

### Get Space Details

```
GET /api/v1/spaces/{spaceId}
```

### Update Space

```
PUT /api/v1/spaces/{spaceId}
```

**Request Body:**
```json
{
  "name": "string (optional)",
  "description": "string (optional)"
}
```

### Delete Space

```
DELETE /api/v1/spaces/{spaceId}
```

### Assign Episodes to Space

```
POST /api/v1/episodes/assign-space
```

**Request Body:**
```json
{
  "spaceId": "string",
  "episodeIds": "[\"episode-id-1\", \"episode-id-2\"]",
  "action": "assign"
}
```

Note: `episodeIds` should be a stringified JSON array.

### Remove Episodes from Space

```
POST /api/v1/episodes/assign-space
```

**Request Body:**
```json
{
  "spaceId": "string",
  "episodeIds": "[\"episode-id-1\", \"episode-id-2\"]",
  "action": "remove"
}
```

### Get Space Episodes

```
GET /api/v1/spaces/{spaceId}/episodes
```

### Get Space Summary

```
GET /api/v1/spaces/{spaceId}/summary
```

### Regenerate Space Summary

```
POST /api/v1/spaces/{spaceId}/summary
```

Triggers manual regeneration of the Space's summary. Returns a task ID that can be used to track the summary generation progress.

**Response:**
```json
{
  "success": true,
  "summary": {
    "taskId": "string",
    "spaceId": "string",
    "triggeredAt": "ISO 8601 timestamp",
    "status": "processing"
  }
}
```

## Troubleshooting

### Space Not Auto-Assigning Memories

If CORE isn't automatically assigning memories to your Space:

1. **Check the description**: Make it more specific and descriptive
2. **Wait for processing**: Auto-assignment may take a few minutes
3. **Manual assignment**: Assign a few relevant episodes manually to "seed" the Space
4. **Review recent activity**: The AI only analyzes recent memories (default: last 25)

### Duplicate Space Names

CORE prevents duplicate Space names within the same workspace:

- Use unique names for each Space
- If you want to recreate a Space, delete the old one first
- Consider using prefixes: `Project-A`, `Project-B`

### Space Summary Not Updating

Summaries regenerate based on significant changes:

- Adding/removing multiple episodes triggers a refresh
- Manual refresh via API: `POST /api/v1/spaces/{spaceId}/summary`
- Check Space status: Must be "ready" (not "processing")

## Learn More

- [Basic Concepts](https://docs.heysol.ai/concepts/memory_graph) - Understanding CORE's memory model
- [API Reference](https://docs.heysol.ai/api-reference) - Complete API documentation
- [MCP Integration](https://docs.heysol.ai/providers/claude) - Connect Spaces with Claude and other tools
