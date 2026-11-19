import { Queue, Worker } from "bullmq";
import { getRedisConnectionOptions } from "./redis";
import { db, queryClient } from "./db";
import { logEvents, settings } from "./schema";
import { lt, eq, sql } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config();

export const RETENTION_QUEUE_NAME = "retention";

/**
 * Setup daily repeatable retention cleanup job in BullMQ
 */
export async function scheduleRetentionJob() {
  const queue = new Queue(RETENTION_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  });

  // Daily at 02:00 AM WIB (Asia/Jakarta) dengan fixed jobId agar tidak duplikat
  await queue.add(
    "daily-log-retention-cleanup",
    {},
    {
      jobId: "daily-log-retention-job",
      repeat: {
        pattern: "0 2 * * *",
        tz: process.env.TZ || "Asia/Jakarta",
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    }
  );

  console.log("Daily log retention repeatable job registered in BullMQ.");
  return queue;
}

/**
 * Perform actual deletion of expired log events based on LOG_RETENTION_DAYS setting.
 * Dilakukan bertahap (batch chunks) untuk mencegah penguncian tabel besar & lonjakan WAL.
 */
export async function runRetentionCleanup(): Promise<{ deletedCount: number; cutoffDate: Date }> {
  const [retentionSetting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "log_retention_days"));

  const days = Number(retentionSetting?.value || process.env.LOG_RETENTION_DAYS || 30);
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(
    `[Retention] Cleaning up log_events older than ${days} days (cutoff: ${cutoffDate.toISOString()})...`
  );

  const CHUNK_SIZE = 5000;
  let totalDeleted = 0;

  while (true) {
    const deletedBatch = await db.execute<{ count: string }>(sql`
      WITH batch AS (
        SELECT id
        FROM log_events
        WHERE event_time < ${cutoffDate.toISOString()}::timestamptz
        LIMIT ${CHUNK_SIZE}
      )
      DELETE FROM log_events
      WHERE id IN (SELECT id FROM batch)
      RETURNING 1;
    `);

    const batchCount = deletedBatch.length;
    totalDeleted += batchCount;

    if (batchCount < CHUNK_SIZE) {
      break;
    }
  }

  console.log(`[Retention] Successfully removed ${totalDeleted} expired log events in batches.`);

  // Bersihkan juga client_errors yang lebih lama dari 30 hari (retensi error klien)
  const clientErrorCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    const deletedClientErrors = await db.execute(sql`
      DELETE FROM client_errors
      WHERE terakhir_terjadi < ${clientErrorCutoff.toISOString()}::timestamptz
      RETURNING 1;
    `);
    console.log(`[Retention] Successfully removed ${deletedClientErrors.length} expired client error reports.`);
  } catch (err) {
    console.warn("[Retention] Gagal membersihkan client_errors kadaluarsa:", err);
  }

  return { deletedCount: totalDeleted, cutoffDate };
}

/**
 * Worker handler for retention jobs
 */
export function startRetentionWorker() {
  const worker = new Worker(
    RETENTION_QUEUE_NAME,
    async (job) => {
      console.log(`[Retention Worker] Executing job ${job.name} (id: ${job.id})`);
      return await runRetentionCleanup();
    },
    {
      connection: getRedisConnectionOptions(),
    }
  );

  worker.on("completed", (job, returnvalue) => {
    console.log(`[Retention Worker] Job ${job.id} completed. Deleted: ${returnvalue?.deletedCount}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Retention Worker] Job ${job?.id} failed:`, err);
  });

  return worker;
}

if (require.main === module || process.argv[1]?.endsWith("cleaner.ts")) {
  runRetentionCleanup()
    .then(async ({ deletedCount }) => {
      console.log(`Retention cleanup finished. Deleted: ${deletedCount}`);
      await queryClient.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Retention cleanup error:", err);
      await queryClient.end();
      process.exit(1);
    });
}
