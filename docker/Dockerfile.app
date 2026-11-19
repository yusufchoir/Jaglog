# Multi-stage Dockerfile for Next.js App
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat iputils

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN mkdir -p /app/public

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PATH="/app/node_modules/.bin:$PATH"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/package.json ./package.json
COPY --chown=nextjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs --from=builder /app/app ./app
COPY --chown=nextjs:nodejs --from=builder /app/shared ./shared
COPY --chown=nextjs:nodejs --from=builder /app/collector ./collector
COPY --chown=nextjs:nodejs --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --chown=nextjs:nodejs --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=nextjs:nodejs docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000 5514/udp 5514/tcp

CMD ["/app/entrypoint.sh"]
