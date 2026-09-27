FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.19.0
# pnpm >=10's runtime dependency-sync check tries to purge and reinstall node_modules on any
# `pnpm` invocation it thinks is stale (it always does, inside a container) - as the non-root
# `node` user that can never succeed against the root-owned node_modules from `deps`, and even
# as root it would attempt a network reinstall. node_modules is already correct at build time.
ENV pnpm_config_verify_deps_before_run=false

# Both published targets depend on this audited, allowlisted build context.
FROM base AS source
COPY . .
RUN node --input-type=module -e 'import fs from "node:fs"; const allowed = new Set(["Dockerfile", ".dockerignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "prisma.config.ts", "next.config.ts", "next-env.d.ts", "tsconfig.json", "postcss.config.mjs", "src", "prisma", "scripts"]); for (const name of fs.readdirSync(".")) if (!allowed.has(name)) throw new Error("Unexpected build context entry"); function walk(p) { for (const e of fs.readdirSync(p, {withFileTypes:true})) { if (e.name.startsWith(".env") || /\.(pem|key|p12|pfx|log|pid)$/.test(e.name) || [".git", ".codex", ".npmrc", "node_modules"].includes(e.name)) throw new Error("Prohibited build context entry"); if(e.isDirectory()) walk(p+"/"+e.name); } } walk(".");'

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile && pnpm exec prisma generate

FROM deps AS builder
COPY --from=source /app/ ./
RUN pnpm build

# Serves both the production db:migrate/db:seed CLI (compose.yaml `migrate`) and the
# compose.dev.yaml dev-server override (`pnpm dev`), which needs the full app source.
# Deliberately does not re-copy package.json/pnpm-lock.yaml/pnpm-workspace.yaml/prisma: those
# are already present from `deps`, and re-copying them would bump their mtimes past what
# `pnpm install` recorded, tripping pnpm's dependency-sync check on every `pnpm` invocation.
FROM deps AS tools
ENV NODE_ENV=production
COPY --from=source --chown=node:node /app/src ./src
COPY --from=source --chown=node:node /app/scripts ./scripts
COPY --from=source --chown=node:node /app/tsconfig.json /app/next.config.ts /app/next-env.d.ts /app/postcss.config.mjs ./
RUN chown node:node /app
USER node
CMD ["sh","-c","pnpm db:migrate && pnpm db:seed"]

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
# The server only needs node; drop the bundled package managers and their dependency CVEs.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.js"]
