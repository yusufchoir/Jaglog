import { db } from "../db";
import { settings } from "../schema";
import { redis } from "../redis";
import { eq } from "drizzle-orm";
import { DetectionThresholds } from "./types";

const SETTINGS_CACHE_TTL = 30; // 30 detik

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  brute_force_login: { max_failures: 10, window_minutes: 5 },
  password_spray: { max_users: 5, window_minutes: 10 },
  success_after_failures: { min_failures: 5, window_minutes: 15 },
  port_scan: { min_ports: 20, window_minutes: 1 },
  device_silent_minutes: 15,
  log_burst_multiplier: 5,
};

/**
 * Mengambil daftar IP yang di-allowlist (dikecualikan dari deteksi serangan)
 */
export async function getIpAllowlist(): Promise<Set<string>> {
  const cacheKey = "settings:ip_allowlist";

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const arr = JSON.parse(cached) as string[];
      return new Set(arr.map((ip) => ip.trim()));
    }
  } catch {
    // Abaikan kegagalan cache
  }

  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "ip_allowlist"))
    .limit(1);

  let ips: string[] = ["127.0.0.1", "::1"];
  if (row?.value) {
    try {
      ips = JSON.parse(row.value);
    } catch {
      ips = row.value.split(",").map((s) => s.trim());
    }
  }

  try {
    await redis.set(cacheKey, JSON.stringify(ips), "EX", SETTINGS_CACHE_TTL);
  } catch {
    // Abaikan
  }

  return new Set(ips.map((ip) => ip.trim()));
}

/**
 * Mengambil konfigurasi ambang batas deteksi dari database / cache
 */
export async function getDetectionThresholds(): Promise<DetectionThresholds> {
  const cacheKey = "settings:detection_thresholds";

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return { ...DEFAULT_THRESHOLDS, ...JSON.parse(cached) };
    }
  } catch {
    // Abaikan
  }

  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "detection_thresholds"))
    .limit(1);

  let thresholds = { ...DEFAULT_THRESHOLDS };
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      thresholds = {
        brute_force_login: {
          ...DEFAULT_THRESHOLDS.brute_force_login,
          ...(parsed.brute_force_login || {}),
        },
        password_spray: {
          ...DEFAULT_THRESHOLDS.password_spray,
          ...(parsed.password_spray || {}),
        },
        success_after_failures: {
          ...DEFAULT_THRESHOLDS.success_after_failures,
          ...(parsed.success_after_failures || {}),
        },
        port_scan: {
          ...DEFAULT_THRESHOLDS.port_scan,
          ...(parsed.port_scan || {}),
        },
        device_silent_minutes:
          parsed.device_silent_minutes ?? DEFAULT_THRESHOLDS.device_silent_minutes,
        log_burst_multiplier:
          parsed.log_burst_multiplier ?? DEFAULT_THRESHOLDS.log_burst_multiplier,
      };
    } catch {
      // Gunakan default
    }
  }

  try {
    await redis.set(cacheKey, JSON.stringify(thresholds), "EX", SETTINGS_CACHE_TTL);
  } catch {
    // Abaikan
  }

  return thresholds;
}
