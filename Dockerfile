# Mehvar Pharmacy — cloud image (PCN-019).
#
# The same code and migrations as the Windows installer, built for Linux.
# Layout in the image mirrors the installer's: app/ holds the server and its
# bundled scripts (app/bin/db, app/bin/ops, app/bin/catalog), migrations/ and
# catalog/ sit beside it.

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Baked into the build AND read at run time, and must match (see .env.example):
# Railway passes service variables to the build as build args.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}

# `next build` imports env-reading modules; these placeholders satisfy the
# schema at build time only and are never used at run time.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SESSION_SECRET=build-time-placeholder-build-time-placeholder \
    npm run build \
 && npm run package:cloud

FROM node:22-bookworm-slim AS run
WORKDIR /srv
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    MEHVAR_DEPLOYMENT=cloud \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /src/dist/cloud /srv
COPY --chown=node:node ops/cloud/predeploy.sh /srv/predeploy.sh
USER node
EXPOSE 3000
CMD ["node", "app/server.js"]
