# CORE - AI Memory Agent Platform

## Project Overview
CORE is a monorepo AI memory agent system. It gives AI tools persistent memory and action capabilities through integrations (Gmail, Calendar, GitHub, Slack, Notion, etc.), a knowledge graph (Neo4j), and vector search (pgvector).

## Tech Stack
- **Framework**: Remix 2.17 + React 19 + Express
- **Language**: TypeScript 5.x
- **Styling**: TailwindCSS 4.1
- **Database**: PostgreSQL (Prisma ORM) + Neo4j (knowledge graph) + Redis (queues)
- **AI**: Vercel AI SDK 6.x, supports OpenAI/Anthropic/Google/Bedrock/Cohere
- **Queue**: BullMQ + Trigger.dev
- **Monorepo**: Turborepo + pnpm

## Project Structure
```
apps/
  webapp/          # Main Remix app (frontend + API)
  telegram-bot/    # Multi-agent Telegram bridge
packages/
  database/        # Prisma schema + migrations
  providers/       # Graph, vector, model provider abstractions
  types/           # Shared TypeScript types
  sdk/             # Published npm SDK (@redplanethq/sdk)
  cli/             # CLI tool (@redplanethq/corebrain)
  emails/          # React Email templates
  mcp-proxy/       # MCP auth proxy
  hook-utils/      # Claude Code plugin hooks
integrations/      # 16 integration modules (GitHub, Slack, Gmail, etc.)
hosting/docker/    # Docker Compose setup
docs/              # API docs, guides
```

## Development Commands
```bash
pnpm install                           # Install dependencies
pnpm turbo dev                         # Dev mode (all packages)
pnpm --filter @core/webapp dev         # Webapp only
pnpm --filter @core/database prisma generate  # Generate Prisma client
pnpm --filter @core/database prisma migrate dev  # Run migrations
pnpm turbo build                       # Build all
pnpm turbo typecheck                   # Type check all
```

## Key Architecture Decisions
- Each integration follows: OAuth → Data Collection → Event Processing → Knowledge Graph Ingestion
- Conversations use a message/parts model with role-based messages
- The agent system uses gather_context (read) and take_action (write) tool patterns
- Reminders are a built-in agent feature, not an external integration
- Personality and capabilities are defined in `apps/webapp/app/services/agent/prompts/`

## Code Style
- TypeScript strict mode
- Functional components with hooks
- Server-side code in `.server.ts` files (Remix convention)
- Route files in `apps/webapp/app/routes/`
- Prisma models in `packages/database/prisma/schema.prisma`

## Important Notes
- Never hardcode API keys - use environment variables
- Vector providers (Qdrant, Turbopuffer) are stub implementations - need completion
- The billing system has placeholder values that need real Stripe integration
- OAuth2 PKCE flow has a known issue that needs fixing
