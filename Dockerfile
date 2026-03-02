# Build stage — uses oven/bun for fast, single-file bundling
FROM oven/bun:1-alpine@sha256:32f1fcccb1523960b254c4f80973bee1a910d60be000a45c20c9129a1efcffee AS builder
WORKDIR /build
COPY package*.json tsconfig.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
RUN bun build src/index.ts --outfile dist/index.js --target node --packages=external --format esm \
 && node -e "const fs=require('fs');const f='dist/index.js';const c=fs.readFileSync(f,'utf8');if(!c.startsWith('#!/'))fs.writeFileSync(f,'#!/usr/bin/env node\n'+c);fs.chmodSync(f,0o755);"

# Runtime stage — npm removed (not needed at runtime, eliminates npm-bundled CVEs)
FROM node:24-alpine@sha256:7fddd9ddeae8196abf4a3ef2de34e11f7b1a722119f91f28ddf1e99dcafdf114
RUN apk add --no-cache ca-certificates \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./
WORKDIR /project
ENTRYPOINT ["node", "/app/dist/index.js", "serve"]
