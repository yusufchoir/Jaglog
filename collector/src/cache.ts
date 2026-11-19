import { db } from "@shared/db";
import { devices } from "@shared/schema";
import { redis } from "@shared/redis";
import { eq } from "drizzle-orm";
import { recordBoundedUnknownSource, normalizeSourceIp } from "@shared/ingest-diagnostics";

export interface CachedDevice {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
  isActive: boolean;
  timezone: string;
}

const CACHE_TTL_SECONDS = 15;
export const DEVICE_CATALOG_REDIS_KEY = "cache:devices:catalog";

interface CatalogCacheState {
  byIp: Map<string, CachedDevice>;
  byName: Map<string, CachedDevice>;
  activeList: CachedDevice[];
  expiresAt: number;
}

let memoryCatalog: CatalogCacheState | null = null;
let inflightCatalogPromise: Promise<CatalogCacheState> | null = null;
const MEMORY_CATALOG_TTL_MS = 500; // 500ms di RAM agar tahan banjir ribuan paket/detik namun instan saat diaktifkan

export function invalidateCollectorDeviceCache(): void {
  memoryCatalog = null;
}

async function getDeviceCatalog(): Promise<CatalogCacheState> {
  const now = Date.now();
  if (memoryCatalog && memoryCatalog.expiresAt > now) {
    return memoryCatalog;
  }

  if (inflightCatalogPromise) {
    return inflightCatalogPromise;
  }

  inflightCatalogPromise = (async () => {
    try {
      let rows: CachedDevice[] | null = null;
      try {
        const cached = await redis.get(DEVICE_CATALOG_REDIS_KEY);
        if (cached) {
          rows = JSON.parse(cached) as CachedDevice[];
        }
      } catch {
        rows = null;
      }

      if (!rows) {
        rows = await db
          .select({
            id: devices.id,
            name: devices.name,
            type: devices.type,
            ipAddress: devices.ipAddress,
            isActive: devices.isActive,
            timezone: devices.timezone,
          })
          .from(devices);

        try {
          await redis.set(DEVICE_CATALOG_REDIS_KEY, JSON.stringify(rows), "EX", CACHE_TTL_SECONDS);
        } catch {
          // Abaikan jika Redis gagal
        }
      }

      const byIp = new Map<string, CachedDevice>();
      const byName = new Map<string, CachedDevice>();
      const activeList: CachedDevice[] = [];

      for (const dev of rows) {
        if (dev.ipAddress && dev.ipAddress.trim() !== "") {
          byIp.set(normalizeSourceIp(dev.ipAddress), dev);
        }
        if (dev.name && dev.name.trim() !== "") {
          byName.set(dev.name.trim().toLowerCase(), dev);
        }
        if (dev.isActive) {
          activeList.push(dev);
        }
      }

      const state: CatalogCacheState = {
        byIp,
        byName,
        activeList,
        expiresAt: Date.now() + MEMORY_CATALOG_TTL_MS,
      };
      memoryCatalog = state;
      return state;
    } finally {
      inflightCatalogPromise = null;
    }
  })();

  return inflightCatalogPromise;
}

/**
 * Mencari perangkat berdasarkan IP Address (IPv4 / IPv6).
 * Menggunakan katalog terpusat agar banjir IP acak tidak membuat kunci Redis baru atau membebani PostgreSQL.
 */
export async function lookupDeviceByIp(ip: string): Promise<CachedDevice | null> {
  const cleanIp = normalizeSourceIp(ip);
  if (!cleanIp || cleanIp === "unknown") return null;

  const catalog = await getDeviceCatalog();
  return catalog.byIp.get(cleanIp) || null;
}

/**
 * Mencari perangkat berdasarkan nama perangkat (case-insensitive) dengan cache katalog
 */
export async function lookupDeviceByName(name: string): Promise<CachedDevice | null> {
  if (!name || name.trim() === "") return null;
  const cleanName = name.trim().toLowerCase();

  const catalog = await getDeviceCatalog();
  return catalog.byName.get(cleanName) || null;
}

/**
 * Fallback jika hanya ada 1 perangkat aktif terdaftar (tanpa IP)
 */
export async function lookupSingleActiveDevice(): Promise<CachedDevice | null> {
  const catalog = await getDeviceCatalog();
  return catalog.activeList.length === 1 ? catalog.activeList[0] : null;
}

/**
 * Mencari perangkat berdasarkan SHA-256 Token Ingest Hash
 */
export async function lookupDeviceByTokenHash(tokenHash: string): Promise<CachedDevice | null> {
  const cacheKey = `device:token:${tokenHash}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedDevice;
    } catch {
      // Abaikan dan query database
    }
  }

  const [device] = await db
    .select({
      id: devices.id,
      name: devices.name,
      type: devices.type,
      ipAddress: devices.ipAddress,
      isActive: devices.isActive,
      timezone: devices.timezone,
    })
    .from(devices)
    .where(eq(devices.ingestTokenHash, tokenHash))
    .limit(1);

  if (!device) {
    await redis.set(cacheKey, JSON.stringify(null), "EX", 10);
    return null;
  }

  await redis.set(cacheKey, JSON.stringify(device), "EX", CACHE_TTL_SECONDS);
  return device;
}

/**
 * Tambah counter unknown sources di Redis jika log berasal dari sumber tak dikenal.
 * Dibatasi maksimal 100 entri dengan TTL 24 jam dan hanya menyimpan agregat (tanpa pesan mentah).
 */
export async function recordUnknownSource(sourceIdentifier: string): Promise<void> {
  await recordBoundedUnknownSource(sourceIdentifier);
}

/**
 * Rate limit per perangkat: maksimal 2000 pesan per detik
 */
export async function checkDeviceIngestRateLimit(deviceId: string, maxPerSecond = 2000): Promise<boolean> {
  const currentSecond = Math.floor(Date.now() / 1000);
  const key = `ratelimit:ingest:${deviceId}:${currentSecond}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 2);
  }

  return count <= maxPerSecond;
}
