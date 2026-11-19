#!/bin/sh
set -e

echo "[JagaLog] Container starting up..."

# Run database migration if DATABASE_URL or POSTGRES_HOST is defined
if [ -n "$DATABASE_URL" ] || [ -n "$POSTGRES_HOST" ]; then
  echo "[JagaLog] Running database migrations..."
  npx tsx shared/src/migrate.ts || echo "[JagaLog Warning] Migrations exited with non-zero status. Continuing to startup..."
  echo "[JagaLog] Running initial seed..."
  npx tsx shared/src/seed.ts || echo "[JagaLog Warning] Seed exited with non-zero status. Continuing to startup..."
else
  echo "[JagaLog Warning] Neither DATABASE_URL nor POSTGRES_HOST found. Skipping migrations."
fi

# Start Syslog Collector daemon & BullMQ workers in background
if [ -f "collector/src/index.ts" ]; then
  echo "[JagaLog] Starting Syslog Collector and BullMQ workers (UDP/TCP Port ${SYSLOG_UDP_PORT:-5514})..."
  COLLECTOR_HEALTH_PORT=8081 npx tsx collector/src/index.ts &
fi

echo "[JagaLog] Starting Next.js server on port ${PORT:-3000}..."
exec npm start
