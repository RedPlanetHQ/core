#!/bin/sh
set -xe

# Ensure runtime Node can resolve workspace-level packages when the root app
# only installs production dependencies. This lets setup scripts reach
# Prisma's client without requiring a duplicate root dependency.
DEFAULT_NODE_PATH="/core/apps/webapp/node_modules:/core/node_modules/.pnpm/node_modules"
if [ -n "$NODE_PATH" ]; then
  export NODE_PATH="${NODE_PATH}:$DEFAULT_NODE_PATH"
else
  export NODE_PATH="$DEFAULT_NODE_PATH"
fi

if [ -n "$DATABASE_HOST" ]; then
  scripts/wait-for-it.sh ${DATABASE_HOST} -- echo "database is up"
fi

# Run migrations
pnpm --filter @core/database db:migrate:deploy

# Generate Prisma client (required for setup scripts)
pnpm --filter @core/database generate

# Setup GitHub integration (idempotent, safe to run on every startup)
node scripts/setup-github-integration.js || true

# Copy over required prisma files
mkdir -p apps/webapp/prisma/
cp packages/database/prisma/schema.prisma apps/webapp/prisma/
# cp node_modules/@prisma/engines/*.node apps/webapp/prisma/

cd /core/apps/webapp
# exec dumb-init pnpm run start:local
exec dumb-init node --max-old-space-size=8192 ./server.js
