import { z } from "zod";
import crypto from "crypto";

// Validasi tipe perangkat
export const deviceTypes = [
  "mikrotik",
  "windows",
  "linux",
  "switch",
  "firewall",
  "other",
] as const;

import type { DeviceType } from "./types";
export type { DeviceType };

// Schema Zod untuk membuat perangkat baru
export const createDeviceSchema = z.object({
  name: z
    .string({ required_error: "Nama perangkat wajib diisi." })
    .trim()
    .min(2, "Nama perangkat minimal 2 karakter.")
    .max(100, "Nama perangkat maksimal 100 karakter."),
  type: z.enum(deviceTypes, {
    errorMap: () => ({ message: "Tipe perangkat tidak valid." }),
  }),
  ipAddress: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (!val || val === "") return true;
        // Regex validasi IPv4 atau IPv6 sederhana
        const ipv4Regex =
          /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
        return ipv4Regex.test(val) || ipv6Regex.test(val);
      },
      { message: "Format alamat IP tidak valid (harus IPv4 atau IPv6 valid)." }
    )
    .transform((val) => (val === "" ? null : val)),
  location: z.string().trim().max(150, "Lokasi maksimal 150 karakter.").optional().nullable(),
  notes: z.string().trim().max(1000, "Catatan maksimal 1000 karakter.").optional().nullable(),
  offlineAfterMinutes: z.coerce
    .number()
    .int("Batas waktu offline harus berupa angka bulat.")
    .min(1, "Minimal 1 menit.")
    .max(1440, "Maksimal 1440 menit (24 jam).")
    .default(10),
  pingEnabled: z.boolean().default(false),
  pingFailureThreshold: z.coerce
    .number()
    .int("Ambang kegagalan harus berupa angka bulat.")
    .min(1, "Minimal 1 kali gagal.")
    .max(10, "Maksimal 10 kali gagal.")
    .default(3),
  notifyOnRto: z.boolean().default(true),
  timezone: z.string().trim().default("Asia/Jakarta"),
  groupId: z.string().uuid("ID grup tidak valid.").optional().nullable(),
});

// Schema Zod untuk update perangkat
export const updateDeviceSchema = createDeviceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type DeviceMonitoringStatus = "online" | "log_stopped" | "offline" | "rto" | "unknown";

/**
 * Generate 32-byte cryptographically secure random token (64 hex characters)
 */
export function generateIngestToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash token ingest dengan SHA-256 sebelum disimpan ke database
 */
export function hashIngestToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Verifikasi apakah token cocok dengan hash yang disimpan
 */
export function verifyIngestToken(token: string, storedHash: string): boolean {
  const incomingHash = hashIngestToken(token);
  // Gunakan timingSafeEqual untuk menghindari timing attack
  if (incomingHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(incomingHash, "utf-8"),
    Buffer.from(storedHash, "utf-8")
  );
}

/**
 * Cek apakah perangkat berstatus "online" (terakhir mengirim log kurang dari offlineAfterMinutes menit lalu)
 */
export function isDeviceOnline(
  lastSeenAt: Date | string | null | undefined,
  offlineAfterMinutes: number = 10
): boolean {
  if (!lastSeenAt) return false;
  const lastSeenTime = new Date(lastSeenAt).getTime();
  const minutes = offlineAfterMinutes > 0 ? offlineAfterMinutes : 10;
  const cutoff = Date.now() - minutes * 60 * 1000;
  return lastSeenTime >= cutoff;
}

/**
 * Hitung status monitoring perangkat:
 * - online: log masuk dalam threshold ATAU host aktif terverifikasi via ping
 * - log_stopped: pernah ada log tapi terhenti, TAPI ping berhasil (hanya jika ping_enabled)
 * - offline: tidak ada log & ping gagal (atau log terhenti & ping gagal/nonaktif)
 * - unknown: belum pernah mengirim log dan belum ada hasil ping
 */
export function calculateDeviceStatus(params: {
  lastSeenAt: Date | string | null | undefined;
  pingEnabled?: boolean | null;
  lastPingAt?: Date | string | null;
  lastPingOk?: boolean | null;
  offlineAfterMinutes?: number | null;
}): DeviceMonitoringStatus {
  const { lastSeenAt, pingEnabled, lastPingOk, offlineAfterMinutes } = params;

  if (!lastSeenAt) {
    if (pingEnabled && lastPingOk === true) {
      return "online";
    }
    if (pingEnabled && lastPingOk === false) {
      return "offline";
    }
    return "unknown";
  }

  const minutes = offlineAfterMinutes && offlineAfterMinutes > 0 ? offlineAfterMinutes : 10;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const lastSeenMs = new Date(lastSeenAt).getTime();

  if (lastSeenMs >= cutoff) {
    return "online";
  }

  // Log stopped: log pernah ada tapi terhenti, TAPI ping host masih berhasil
  if (pingEnabled && lastPingOk === true) {
    return "log_stopped";
  }

  // Offline: log berhenti dan ping gagal (atau ping_enabled tidak aktif)
  return "offline";
}
