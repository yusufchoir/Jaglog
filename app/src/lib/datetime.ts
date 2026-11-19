"use client";

import { useEffect, useState } from "react";

/**
 * Utilitas Terpusat Format Tanggal & Waktu (WIB / Asia/Jakarta)
 * Mencegah hydration mismatch akibat perbedaan zona waktu server vs browser.
 */

const JAKARTA_TZ = "Asia/Jakarta";

export function toValidDate(input: Date | string | number | null | undefined): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format tanggal dan jam lengkap dalam zona Asia/Jakarta
 * Contoh: "13/11/2026, 10:15:30 WIB"
 */
export function formatWIBDateTime(input: Date | string | number | null | undefined): string {
  const d = toValidDate(input);
  if (!d) return "-";
  return (
    d.toLocaleString("id-ID", {
      timeZone: JAKARTA_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + " WIB"
  );
}

/**
 * Format tanggal saja (misal: "13 Nov 2026")
 */
export function formatWIBDate(
  input: Date | string | number | null | undefined,
  options?: { month?: "numeric" | "2-digit" | "short" | "long" }
): string {
  const d = toValidDate(input);
  if (!d) return "-";
  return d.toLocaleDateString("id-ID", {
    timeZone: JAKARTA_TZ,
    day: "numeric",
    month: options?.month || "short",
    year: "numeric",
  });
}

/**
 * Format jam saja (misal: "10:15:30")
 */
export function formatWIBTime(
  input: Date | string | number | null | undefined,
  options?: { withSeconds?: boolean }
): string {
  const d = toValidDate(input);
  if (!d) return "-";
  return d.toLocaleTimeString("id-ID", {
    timeZone: JAKARTA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: options?.withSeconds !== false ? "2-digit" : undefined,
    hour12: false,
  });
}

/**
 * Format waktu relatif (misal: "5 menit lalu", "Baru saja")
 */
export function formatRelativeTime(
  timestamp: string | number | Date | null | undefined
): string {
  const d = toValidDate(timestamp);
  if (!d) return "Belum pernah terlihat";

  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "Baru saja";

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Baru saja";
  if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
  if (diffHours < 24) return `${diffHours} jam lalu`;
  return `${diffDays} hari lalu`;
}

/**
 * Hook bantuan untuk mendeteksi apakah komponen telah ter-mount di browser
 * Berguna untuk menunda render elemen yang bergantung browser agar tidak terjadi hydration mismatch.
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

