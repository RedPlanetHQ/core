# Copilot Instructions for CORE

## Project Context
CORE is a TypeScript monorepo - an AI memory agent platform with integrations, knowledge graph, and multi-agent capabilities.

## Code Style
- Use TypeScript strict mode, no `any` unless absolutely necessary
- Functional React components with hooks (no class components)
- Server-side code goes in `.server.ts` files (Remix convention)
- Use Prisma for all database operations
- Use Zod for runtime validation
- Keep functions small and focused
- Prefer early returns over nested if/else

## Architecture Patterns
- **Integrations**: OAuth → Sync → Event Processing → Knowledge Graph
- **Agent Tools**: gather_context (read), take_action (write), add_reminder (schedule)
- **API Routes**: Remix route convention in `apps/webapp/app/routes/`
- **Shared Types**: Define in `packages/types/`, import everywhere else

## Important Rules
- Never hardcode secrets or API keys
- Always handle errors - don't let promises go uncaught
- Use BullMQ for async jobs, not setTimeout/setInterval
- Prisma transactions for multi-step DB operations
- Rate limit external API calls in integrations

## Current Priority Work
See `.github/CODEX_TASKS.md` for the full prioritized task list.
Top priorities: Vector providers, PKCE fix, Stripe billing, test coverage.
