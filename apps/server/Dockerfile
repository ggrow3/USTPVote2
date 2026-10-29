# syntax=docker/dockerfile:1
#
# The server image: one image, three Cloud Run services (design §3.1, §3.4, §15). Terraform and the release workflow
# run it as
#   node dist/main-api.js                         api (the default command)
#   node dist/main-worker.js                      worker
#   node /app/apps/mcp/dist/main.js --http ...    mcp, the reporting MCP server
# from /app/apps/server, listening on $PORT. Build it from the repository root:
#   docker build -f apps/server/Dockerfile -t ustp-server .

# Node 26 LTS (.nvmrc), pinned by digest (design §14). Dependabot keeps both stages on the same digest.
FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS build
WORKDIR /src

# Locked dependencies, no install scripts (spec §7; .npmrc sets ignore-scripts too). npm ci checks the lockfile against
# every workspace's package.json, so all of them are copied, but only the server's and the MCP server's are installed.
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/tally/package.json packages/tally/
COPY packages/audit/package.json packages/audit/
COPY packages/domain/package.json packages/domain/
COPY packages/verify/package.json packages/verify/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --include-workspace-root \
      -w packages/tally -w packages/audit -w packages/domain -w packages/verify -w apps/server -w apps/mcp

COPY packages/tally packages/tally
COPY packages/audit packages/audit
COPY packages/domain packages/domain
COPY packages/verify packages/verify
COPY apps/server apps/server
COPY apps/mcp apps/mcp
RUN npm run build -w packages/tally -w packages/audit -w packages/domain -w packages/verify -w apps/server -w apps/mcp

# Reinstall with the server's and the MCP server's production dependencies only, then gather what runs into /out: the
# lockfile's node_modules (workspace packages are relative symlinks into packages/), each package's compiled dist, and
# any workspace-local node_modules.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --omit=dev -w apps/server -w apps/mcp \
 && mkdir /out \
 && cp -a --parents package.json node_modules /out/ \
 && for ws in packages/tally packages/audit packages/domain packages/verify apps/server apps/mcp; do \
      cp -a --parents "$ws/package.json" "$ws/dist" /out/; \
      if [ -d "$ws/node_modules" ]; then cp -a --parents "$ws/node_modules" /out/; fi; \
    done

FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec
# Stack traces point into the TypeScript sources; Nest's startup log is plain text for Cloud Logging.
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    NO_COLOR=1
# Owned by root and read-only to the process, which runs as the image's unprivileged node user.
COPY --from=build /out /app
WORKDIR /app/apps/server
USER node
EXPOSE 8080
# The commit the release workflow built (design §15): the api reports it in GET /v1/health and the X-Build-Commit header,
# and the web app compares it with its own. Empty in other builds. Last, so every layer above stays cached.
ARG BUILD_COMMIT=""
ENV BUILD_COMMIT=$BUILD_COMMIT
CMD ["node", "dist/main-api.js"]
