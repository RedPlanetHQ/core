# Repository Guidelines

## Project Structure & Module Organization
- `apps/webapp`: Remix + Vite experience layer with routes under `app/`.
- `apps/init`: Trigger.dev bootstrap CLI and supporting scripts.
- `packages/database`: Prisma schema, migrations (`prisma/migrations`), and seed helpers.
- `packages/types`, `packages/mcp-proxy`, `packages/emails`, `packages/sdk`: shared contracts, MCP handlers, notification templates, and client utilities.
- `docker/`, `hosting/`, `scripts/`: deployment recipes and automation. Seed secrets from `.env.example`; Turbo loads them globally.

## Build, Test, and Development Commands
- `pnpm install` (Node 18+) hydrates the workspace.
- `pnpm --filter webapp dev` runs the Remix app; `pnpm --filter @redplanethq/init dev` watches the CLI.
- `pnpm build` executes the Turbo build graph for release or CI.
- `pnpm lint`, `pnpm check-types`, `pnpm format` enforce ESLint, TypeScript, and Prettier.
- `pnpm db:migrate` / `pnpm db:seed` manage Prisma schema changes.

## Coding Style & Naming Conventions
- Prettier rules: 2-space indent, 100-character lines, double quotes, trailing commas (`pnpm format`).
- Respect ESLint warnings; components and routes in PascalCase, hooks in camelCase with `use`, utilities in kebab-case.
- Reuse models from `packages/types`; colocate UI assets with their component.

## Testing Guidelines
- Vitest drives unit coverage. Use `pnpm --filter @redplanethq/init test` for CLI suites and `pnpm --filter @redplanethq/init test:e2e` for trigger flows in `apps/init/e2e`.
- Add Remix specs under `apps/webapp/app` with `@remix-run/testing`, mirroring the route path and suffixing `.test.ts(x)`.
- Seed data through Prisma helpers and cover both success and failure paths for graph or billing-sensitive code.

## Commit & Pull Request Guidelines
- Prefer Conventional-style prefixes (`fix:`, `feat:`, `chore:`) plus a present-tense summary; reference issues or PR IDs when relevant (`(#82)`).
- Keep schema migrations with their corresponding Prisma changes and mention them in the PR body.
- PR checklist: describe scope, note env or migration needs, list executed checks (e.g., `✅ pnpm lint`), and attach screenshots or Looms for UI updates.

## Security & Configuration Tips
- Never commit populated `.env`; sync secrets from `.env.example` and shared vaults.
- Align new environment variables with the `turbo.json` `globalEnv` array so CI exposes missing configuration quickly.
- Redact Neo4j, Stripe, AWS, and Trigger.dev identifiers when sharing logs or debugging output.
