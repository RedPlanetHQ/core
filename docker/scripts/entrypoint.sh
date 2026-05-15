#!/bin/sh
set -xe

if [ -n "$DATABASE_HOST" ]; then
  scripts/wait-for-it.sh ${DATABASE_HOST} -- echo "database is up"
fi

# Run migrations
pnpm --filter @core/database db:migrate:deploy

# Copy over required prisma files
mkdir -p apps/webapp/prisma/
cp packages/database/prisma/schema.prisma apps/webapp/prisma/
# cp node_modules/@prisma/engines/*.node apps/webapp/prisma/

cd /core/apps/webapp
# exec dumb-init pnpm run start:local
NODE_PATH='/core/node_modules/.pnpm/node_modules' exec dumb-init node --max-old-space-size=8192 --expose-gc ./server.js
