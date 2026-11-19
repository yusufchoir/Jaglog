import crypto from "crypto";
import { redis } from "./redis";
import { db } from "./db";
import { logEvents, logTopPatterns } from "./schema";
import { eq, sql } from "drizzle-orm";
import { normalizeMessage } from "./log-filter";

const DEFAULT_RATE_LIMIT_PER_SEC = 200;
const DEDUPE_WINDOW_SECONDS = 60;

/**
 * Buat hash cepat dari pola pesan yang sudah dinormalisasi
 */
export function getPatternHash(message: string): string {
  const norm = normalizeMessage(message);
  return crypto.createHash("md5").update(norm).digest("hex");
}

/**
 * Cek dan hitung rate limit pesan per detik per perangkat.
 * Menggunakan Redis sliding second bucket.
 */
export async function checkDeviceRateLimit(
  deviceId: string,
  limitPerSecond: number = DEFAULT_RATE_LIMIT_PER_SEC
): Promise<{ allowed: boolean; currentRate: number }> {
  try {
    const secondBucket = Math.floor(Date.now() / 1000);
    const key = `ratelimit:${deviceId}:${secondBucket}`;

    const count = await redis.incr(key);
    if (count === 1) {
      // Set TTL 5 detik agar key otomatis bersih
      await redis.expire(key, 5);
    }

    if (count > limitPerSecond) {
      // Catat statistik pesan dibuang karena rate limit per perangkat dan total global
      const today = new Date().toISOString().slice(0, 10);
      const droppedKey = `ratelimit:dropped:${deviceId}:${today}`;
      const totalKey = `ratelimit:dropped:total:${today}`;

      await redis.incr(droppedKey);
      await redis.expire(droppedKey, 86400 * 3); // Simpan 3 hari
      await redis.incr(totalKey);
      await redis.expire(totalKey, 86400 * 3);

      return { allowed: false, currentRate: count };
    }

    return { allowed: true, currentRate: count };
  } catch (err) {
    // Jika Redis down, izinkan log lewat (fail-open)
    return { allowed: true, currentRate: 0 };
  }
}

/**
 * Dapatkan jumlah pesan yang dibuang akibat rate limit hari ini.
 * Membaca counter O(1) langsung tanpa memblokir event loop Redis (tanpa redis.keys).
 */
export async function getDroppedRateLimitCount(deviceId?: string): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (deviceId) {
      const droppedKey = `ratelimit:dropped:${deviceId}:${today}`;
      const val = await redis.get(droppedKey);
      return val ? parseInt(val, 10) : 0;
    }

    // Hitung seluruh perangkat langsung dari agregasi counter harian global
    const totalKey = `ratelimit:dropped:total:${today}`;
    const totalVal = await redis.get(totalKey);
    return totalVal ? parseInt(totalVal, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Tandai pola pesan tertentu dalam status perlindungan banjir aktif (auto flood protection).
 * Berlaku selama durationSeconds (default 15 menit).
 */
export async function setTemporaryFloodProtection(
  deviceId: string,
  patternHash: string,
  durationSeconds = 900
): Promise<void> {
  const key = `flood:protect:${deviceId}:${patternHash}`;
  await redis.set(key, "1", "EX", durationSeconds);
}

/**
 * Cek apakah pola sedang dalam perlindungan banjir aktif
 */
export async function isFloodProtected(
  deviceId: string,
  patternHash: string
): Promise<boolean> {
  try {
    const key = `flood:protect:${deviceId}:${patternHash}`;
    const val = await redis.get(key);
    return val === "1";
  } catch {
    return false;
  }
}

/**
 * State manager untuk deduplikasi pesan berulang dalam jendela 60 detik.
 */
export interface DedupeCheckResult {
  isDuplicate: boolean;
  parentLogId?: number;
  repeatCount?: number;
}

/**
 * Cek apakah pesan ini duplikat dalam jendela 60 detik untuk perangkat ini.
 * Jika belum ada: return isDuplicate=false, caller meng-insert row DB dan memanggil registerDedupeParent.
 * Jika sudah ada: return isDuplicate=true dan parentLogId, caller meng-increment count tanpa insert row baru.
 */
export async function checkAndTrackDedupe(
  deviceId: string,
  patternHash: string
): Promise<{ isDuplicate: boolean; parentLogId?: number }> {
  try {
    const key = `dedupe:window:${deviceId}:${patternHash}`;
    const parentIdStr = await redis.get(key);

    if (parentIdStr) {
      const parentLogId = parseInt(parentIdStr, 10);
      // Increment counter akumulasi di Redis
      const countKey = `dedupe:count:${deviceId}:${parentLogId}`;
      await redis.incr(countKey);
      await redis.expire(countKey, DEDUPE_WINDOW_SECONDS + 30);
      return { isDuplicate: true, parentLogId };
    }

    return { isDuplicate: false };
  } catch (err) {
    return { isDuplicate: false };
  }
}

/**
 * Daftarkan baris log_events yang baru saja di-insert sebagai parent jendela 60s
 */
export async function registerDedupeParent(
  deviceId: string,
  patternHash: string,
  logId: number
): Promise<void> {
  try {
    const key = `dedupe:window:${deviceId}:${patternHash}`;
    await redis.set(key, logId.toString(), "EX", DEDUPE_WINDOW_SECONDS);

    const countKey = `dedupe:count:${deviceId}:${logId}`;
    await redis.set(countKey, "1", "EX", DEDUPE_WINDOW_SECONDS + 30);
  } catch {
    // Abaikan jika Redis gagal
  }
}

/**
 * Flush penambahan repeat_count ke tabel log_events di DB secara berkala.
 * Dipanggil secara reguler oleh worker atau scheduler.
 */
export async function flushDedupeCountsToDb(
  updates: Array<{ logId: number; additionalCount: number; lastEventTime: Date }>
): Promise<void> {
  if (updates.length === 0) return;

  for (const item of updates) {
    if (item.additionalCount <= 0) continue;
    try {
      await db
        .update(logEvents)
        .set({
          repeatCount: sql`${logEvents.repeatCount} + ${item.additionalCount}`,
          eventTime: item.lastEventTime,
        })
        .where(eq(logEvents.id, item.logId));
    } catch (err) {
      console.error(`[Dedupe Flush Error] logId: ${item.logId}`, err);
    }
  }
}

/**
 * Catat frekuensi pola pesan untuk agregasi tabel `log_top_patterns`
 * Menggunakan Redis hash per jam agar tidak membebani PostgreSQL di setiap pesan.
 */
export async function recordPatternFrequency(
  deviceId: string,
  message: string,
  severity: number
): Promise<void> {
  try {
    const norm = normalizeMessage(message);
    const hash = crypto.createHash("md5").update(norm).digest("hex").slice(0, 16);
    const now = new Date();
    // Hour bucket YYYY-MM-DDTHH:00
    const hourBucket = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours()
    ).toISOString();

    const redisKey = `top_patterns:${deviceId}:${hourBucket}`;
    const fieldKey = `${hash}`;

    // Simpan data JSON di redis hash
    const existing = await redis.hget(redisKey, fieldKey);
    let data = {
      normalized: norm,
      example: message.slice(0, 200),
      count: 0,
      minSev: severity,
      maxSev: severity,
    };

    if (existing) {
      try {
        data = JSON.parse(existing);
      } catch {}
    }

    data.count += 1;
    data.minSev = Math.min(data.minSev, severity);
    data.maxSev = Math.max(data.maxSev, severity);

    await redis.hset(redisKey, fieldKey, JSON.stringify(data));
    await redis.expire(redisKey, 86400 * 2); // Simpan 2 hari
  } catch {
    // Non-blocking
  }
}
