# Build context: repository root.  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @operaflow/shared --workspace @operaflow/db --workspace @operaflow/api --include-workspace-root
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @operaflow/shared && npm run build -w @operaflow/db && npm run build -w @operaflow/api

# One-shot job: applies pending migrations, then exits.
FROM build AS migrate
WORKDIR /app/packages/db
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prune
RUN npm prune --omit=dev --workspace @operaflow/shared --workspace @operaflow/db --workspace @operaflow/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prune --chown=node:node /app/node_modules node_modules
COPY --from=prune --chown=node:node /app/packages/shared/package.json /app/packages/shared/
COPY --from=prune --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=prune --chown=node:node /app/packages/db/package.json /app/packages/db/
COPY --from=prune --chown=node:node /app/packages/db/dist packages/db/dist
COPY --from=prune --chown=node:node /app/apps/api/package.json apps/api/
COPY --from=prune --chown=node:node /app/apps/api/dist apps/api/dist
# Chromium + system libraries for the Playwright test engine (used by the worker and inline runs).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*
# Document store; a named volume mounted here inherits this ownership on first use.
RUN mkdir -p /app/storage && chown node:node /app/storage
ENV STORAGE_DIR=/app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
