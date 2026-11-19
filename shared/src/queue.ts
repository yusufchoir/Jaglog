import { Queue } from "bullmq";
import { getRedisConnectionOptions, redis } from "./redis";

export const INGEST_QUEUE_NAME = "ingest";

export interface RawLogPayload {
  deviceId: string;
  raw: string;
  receivedAt: string;
  sourceIp?: string;
  facility?: number;
  severity?: number;
  sourceApp?: string;
  message: string;
  eventTime: string;
  category?: "auth" | "network" | "system" | "firewall" | "config" | "other";
  parsed?: Record<string, unknown>;
  deviceType?: string;
}

let ingestQueueInstance: Queue<RawLogPayload> | null = null;

export function getIngestQueue(): Queue<RawLogPayload> {
  if (!ingestQueueInstance) {
    ingestQueueInstance = new Queue<RawLogPayload>(INGEST_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 3600 },
        removeOnFail: { count: 500, age: 86400 },
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });
  }
  return ingestQueueInstance;
}

/**
 * Menambahkan batch log events ke antrian BullMQ dengan perlindungan backpressure
 */
export async function enqueueLogEvents(events: RawLogPayload[]): Promise<boolean> {
  if (events.length === 0) return true;
  const queue = getIngestQueue();

  // Perlindungan Backpressure: Bila antrian meledak > 50,000 item (misal DB downstream macet),
  // drop batch agar memori Redis tetap aman dan catat metrik backpressure
  try {
    const depth = await queue.count();
    if (depth > 50000) {
      console.warn(
        `[Ingest Backpressure] Antrian ingest penuh (${depth} items > 50000). Menjatuhkan ${events.length} pesan.`
      );
      await redis.incrby("metrics:dropped_backpressure", events.length).catch(() => {});
      return false;
    }
  } catch (err) {
    // Abaikan kegagalan baca metrik depth, lanjutkan enqueue
  }

  const jobs = events.map((event) => ({
    name: "ingest-log",
    data: event,
  }));

  await queue.addBulk(jobs);
  return true;
}

/**
 * Bersihkan job lama dari antrian untuk mencegah pembengkakan memori Redis
 */
export async function cleanOldQueueJobs(): Promise<{ completedRemoved: number; failedRemoved: number }> {
  try {
    const queue = getIngestQueue();
    const completed = await queue.clean(3600 * 1000, 100, "completed");
    const failed = await queue.clean(86400 * 1000, 500, "failed");
    return {
      completedRemoved: Array.isArray(completed) ? completed.length : 0,
      failedRemoved: Array.isArray(failed) ? failed.length : 0,
    };
  } catch (err) {
    console.warn("[Queue] Clean old jobs error:", err);
    return { completedRemoved: 0, failedRemoved: 0 };
  }
}

export const NOTIFY_QUEUE_NAME = "notify";

export interface NotificationJobPayload {
  deviceId: string;
  deviceName: string;
  deviceIp?: string | null;
  eventType: "ping_rto" | "ping_recovered" | "device_offline" | "device_recovered" | "flapping_detected";
  startTimeWib: string;
  durationText?: string;
  suspectedCause: string;
  deviceUrl: string;
}

let notifyQueueInstance: Queue<NotificationJobPayload> | null = null;

export function getNotifyQueue(): Queue<NotificationJobPayload> {
  if (!notifyQueueInstance) {
    notifyQueueInstance = new Queue<NotificationJobPayload>(NOTIFY_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail: { count: 200, age: 86400 * 3 },
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    });
  }
  return notifyQueueInstance;
}

export async function enqueueNotification(payload: NotificationJobPayload): Promise<boolean> {
  try {
    const queue = getNotifyQueue();
    await queue.add("dispatch-notification", payload);
    return true;
  } catch (err) {
    console.error("[Notify Queue Error] Gagal enqueue notifikasi:", err);
    return false;
  }
}
