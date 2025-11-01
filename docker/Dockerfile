ARG NODE_IMAGE=node:20.11.1-bullseye-slim@sha256:5a5a92b3a8d392691c983719dbdc65d9f30085d6dcd65376e7a32e6fe9bf4cbe

# Python dependencies build stage - using Python 3.9 to match Debian Bullseye
FROM python:3.9-slim-bullseye AS python-builder
WORKDIR /python-build
COPY apps/webapp/python/requirements.txt .

# Install build dependencies and Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --target=/python-install -r requirements.txt \
    && find /python-install -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true \
    && find /python-install -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true \
    && find /python-install -name '*.pyc' -delete \
    && find /python-install -name '*.pyo' -delete

FROM ${NODE_IMAGE} AS pruner

WORKDIR /core

COPY --chown=node:node . .
RUN npx -q turbo@2.5.3 prune --scope=webapp --docker
RUN find . -name "node_modules" -type d -prune -exec rm -rf '{}' +

# Base strategy to have layer caching
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y openssl dumb-init
WORKDIR /core
COPY --from=pruner --chown=node:node /core/out/json/ .
COPY --from=pruner --chown=node:node /core/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner --chown=node:node /core/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

## Dev deps
FROM base AS dev-deps
WORKDIR /core
# Corepack is used to install pnpm
RUN corepack enable
ENV NODE_ENV development
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --ignore-scripts --no-frozen-lockfile

## Production deps
FROM base AS production-deps
WORKDIR /core
# Corepack is used to install pnpm
RUN corepack enable
ENV NODE_ENV production
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --prod --no-frozen-lockfile
COPY --from=pruner --chown=node:node /core/packages/database/prisma/schema.prisma /core/packages/database/prisma/schema.prisma
# RUN pnpm add @prisma/client@5.1.1 -w
ENV NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK true
RUN pnpx prisma@5.4.1 generate --schema /core/packages/database/prisma/schema.prisma

## Builder (builds the webapp)
FROM base AS builder
WORKDIR /core
# Corepack is used to install pnpm
RUN corepack enable

COPY --from=pruner --chown=node:node /core/out/full/ .
COPY --from=dev-deps --chown=node:node /core/ .
COPY --chown=node:node turbo.json turbo.json
COPY --chown=node:node docker/scripts ./scripts
RUN chmod +x ./scripts/wait-for-it.sh
RUN chmod +x ./scripts/entrypoint.sh
COPY --chown=node:node .configs/tsconfig.base.json .configs/tsconfig.base.json
RUN pnpm run generate
RUN pnpm run build --filter=webapp...

# Runner
FROM ${NODE_IMAGE} AS runner
RUN apt-get update && apt-get install -y \
    openssl \
    netcat-openbsd \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /core
RUN corepack enable
ENV NODE_ENV production

# Set PYTHONPATH to include our custom package location
ENV PYTHONPATH=/opt/python-packages

COPY --from=base /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=pruner --chown=node:node /core/out/full/ .
COPY --from=production-deps --chown=node:node /core .
COPY --from=builder --chown=node:node /core/apps/webapp/server.js ./apps/webapp/server.js
COPY --from=builder --chown=node:node /core/apps/webapp/build ./apps/webapp/build
COPY --from=builder --chown=node:node /core/apps/webapp/public ./apps/webapp/public
COPY --from=builder --chown=node:node /core/scripts ./scripts

# Copy pre-built Python dependencies from python-builder stage
COPY --from=python-builder --chown=node:node /python-install /opt/python-packages

# Copy BERT scripts
COPY --chown=node:node apps/webapp/python/requirements.txt ./apps/webapp/python/requirements.txt
COPY --chown=node:node apps/webapp/python/main.py ./apps/webapp/python/main.py

EXPOSE 3000

USER node
CMD ["./scripts/entrypoint.sh"]
