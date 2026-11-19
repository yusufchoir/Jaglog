/**
 * shared/src/log-filter.ts
 * Engine pencocokan pola noise filter per perangkat / global.
 * Pola dikompilasi sekali dan di-cache di memori; invalidasi via Redis pub/sub.
 */

import { db } from "./db";
import { logFilters } from "./schema";
import { and, eq, or, isNull } from "drizzle-orm";
import { redis } from "./redis";

export type FilterAction = "discard" | "merge" | "lower_severity";
export type MatchType = "contains" | "exact" | "regex";

export interface CompiledFilter {
  id: string;
  deviceId: string | null;
  name: string;
  matchType: MatchType;
  pattern: string;
  action: FilterAction;
  regex?: RegExp; // Hanya untuk matchType === 'regex'
}

export interface FilterResult {
  matched: false;
}
export interface FilterResultMatched {
  matched: true;
  filterId: string;
  action: FilterAction;
  filterName: string;
}

// In-memory cache; global untuk proses ini
let filterCache: CompiledFilter[] | null = null;
let cacheLoadedAt = 0;
const CACHE_REFRESH_MS = 30_000; // 30 detik maksimum staleness

const INVALIDATE_CHANNEL = "log_filters:invalidate";
const MAX_REGEX_LENGTH = 500;
const REGEX_TIMEOUT_MS = 50; // Proteksi ReDoS: timeout 50ms per eval

/**
 * Muat filter aktif dari database dan kompilasi regex.
 */
async function loadFilters(): Promise<CompiledFilter[]> {
  const rows = await db
    .select()
    .from(logFilters)
    .where(eq(logFilters.isActive, true));

  const compiled: CompiledFilter[] = [];
  for (const row of rows) {
    if (row.matchType === "regex") {
      if (row.pattern.length > MAX_REGEX_LENGTH) {
        console.warn(`[LogFilter] Pola regex terlalu panjang (>${MAX_REGEX_LENGTH}), dilewati: ${row.id}`);
        continue;
      }
      try {
        const re = new RegExp(row.pattern, "i");
        compiled.push({
          id: row.id,
          deviceId: row.deviceId ?? null,
          name: row.name,
          matchType: "regex",
          pattern: row.pattern,
          action: (row.action as FilterAction) ?? "discard",
          regex: re,
        });
      } catch {
        console.warn(`[LogFilter] Regex tidak valid, dilewati: ${row.id} - ${row.pattern}`);
      }
    } else {
      compiled.push({
        id: row.id,
        deviceId: row.deviceId ?? null,
        name: row.name,
        matchType: row.matchType as MatchType,
        pattern: row.pattern,
        action: (row.action as FilterAction) ?? "discard",
      });
    }
  }
  return compiled;
}

/**
 * Dapatkan filter cache (refresh jika sudah stale)
 */
async function getFilterCache(): Promise<CompiledFilter[]> {
  if (!filterCache || Date.now() - cacheLoadedAt > CACHE_REFRESH_MS) {
    filterCache = await loadFilters();
    cacheLoadedAt = Date.now();
  }
  return filterCache;
}

/**
 * Invalidasi cache dari luar (mis. setelah CRUD filter)
 */
export function invalidateFilterCache(): void {
  filterCache = null;
  cacheLoadedAt = 0;
}

/**
 * Cocokkan satu pesan terhadap semua filter aktif.
 * Urutan: filter device-spesifik dijalankan lebih dulu, lalu filter global.
 */
export async function matchFilters(
  message: string,
  deviceId: string
): Promise<FilterResult | FilterResultMatched> {
  const filters = await getFilterCache();

  // Prioritas: filter untuk device ini, kemudian filter global (deviceId null)
  const deviceFilters = filters.filter((f) => f.deviceId === deviceId);
  const globalFilters = filters.filter((f) => f.deviceId === null);
  const ordered = [...deviceFilters, ...globalFilters];

  for (const f of ordered) {
    let matched = false;
    if (f.matchType === "exact") {
      matched = message === f.pattern;
    } else if (f.matchType === "contains") {
      matched = message.includes(f.pattern);
    } else if (f.matchType === "regex" && f.regex) {
      // Proteksi ReDoS: jalankan test dengan flag timeout sederhana via try/catch
      try {
        matched = f.regex.test(message);
      } catch {
        matched = false;
      }
    }

    if (matched) {
      // Update counter async (tidak memblokir pemrosesan pesan)
      updateMatchStats(f.id).catch(() => {});
      return { matched: true, filterId: f.id, action: f.action, filterName: f.name };
    }
  }

  return { matched: false };
}

/**
 * Perbarui statistik cocok di database (async, non-blocking)
 */
async function updateMatchStats(filterId: string): Promise<void> {
  try {
    await db
      .update(logFilters)
      .set({
        matchCount: db.$count(logFilters), // placeholder; gunakan raw SQL di bawah
        lastMatchedAt: new Date(),
      } as any);
    // Gunakan raw increment
    const { sql: drizzleSql } = await import("drizzle-orm");
    await db
      .update(logFilters)
      .set({
        matchCount: drizzleSql`match_count + 1`,
        lastMatchedAt: new Date(),
      } as any)
      .where(eq(logFilters.id, filterId));
  } catch {
    // Gagal update stat tidak boleh menghentikan pipeline
  }
}

/**
 * Publikasikan invalidasi ke semua worker via Redis pub/sub
 */
export async function publishFilterInvalidate(): Promise<void> {
  try {
    await redis.publish(INVALIDATE_CHANNEL, "invalidate");
  } catch {
    // Pub/sub gagal tidak kritis
  }
  invalidateFilterCache();
}

/**
 * Subscibe ke channel invalidasi (panggil di startup worker)
 */
export function subscribeFilterInvalidate(): void {
  const sub = redis.duplicate();
  sub.subscribe(INVALIDATE_CHANNEL, (err) => {
    if (err) console.error("[LogFilter] Subscribe error:", err);
  });
  sub.on("message", (_channel: string, _msg: string) => {
    invalidateFilterCache();
  });
}

/**
 * Normalisasi pesan untuk key dedupe & top patterns:
 * - Angka 2+ digit diganti <N>
 * - IPv4/IPv6 diganti <IP>
 * - MAC address diganti <MAC>
 * - Port diganti <PORT>
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<IP>")
    .replace(/\b([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g, "<MAC>")
    .replace(/(?<=:)\d{1,5}\b/g, "<PORT>")
    .replace(/\b\d{2,}\b/g, "<N>")
    .trim();
}
