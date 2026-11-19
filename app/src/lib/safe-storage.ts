"use client";

/**
 * Utilitas Penyimpanan Aman (safe-storage)
 * Memvalidasi bentuk data tersimpan di localStorage/sessionStorage,
 * menangani versi skema, memulihkan data rusak secara otomatis,
 * dan mencegah kegagalan runtime akibat format usang atau JSON korup.
 */

const STORAGE_SCHEMA_VERSION = 1;

interface StorageEnvelope<T> {
  _v: number;
  data: T;
  ts: number;
}

/**
 * Baca JSON dari localStorage dengan validasi tipe defensif & fallback aman
 */
export function safeGetJSON<T>(
  key: string,
  fallback: T,
  validator?: (val: unknown) => val is T
): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Data rusak / bukan JSON valid -> bersihkan dan tulis ulang fallback
      console.warn(`[SafeStorage] Data korup pada key '${key}'. Mereset ke default.`);
      safeSetJSON(key, fallback);
      return fallback;
    }

    // Ekstrak data jika menggunakan format envelope
    const dataCandidate =
      parsed && typeof parsed === "object" && "_v" in parsed && "data" in parsed
        ? parsed.data
        : parsed;

    // Jika validator disediakan, pastikan bentuk data sesuai
    if (validator) {
      if (validator(dataCandidate)) {
        return dataCandidate;
      } else {
        console.warn(`[SafeStorage] Data tidak lolos validasi pada key '${key}'. Mereset ke default.`);
        safeSetJSON(key, fallback);
        return fallback;
      }
    }

    return (dataCandidate as T) ?? fallback;
  } catch (err) {
    console.warn(`[SafeStorage] Gagal membaca key '${key}':`, err);
    return fallback;
  }
}

/**
 * Tulis JSON ke localStorage dengan envelope versi skema
 */
export function safeSetJSON<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;

  try {
    const envelope: StorageEnvelope<T> = {
      _v: STORAGE_SCHEMA_VERSION,
      data: value,
      ts: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    // QuotaExceededError atau private browsing mode
    console.warn(`[SafeStorage] Gagal menyimpan key '${key}':`, err);
  }
}

/**
 * Hapus key dari localStorage
 */
export function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ==========================================
// ACCESSOR SPESIFIK & TERVALIDASI
// ==========================================

export function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === "string");
}

/**
 * Ambil daftar grup terlipat untuk peta tertentu secara aman
 */
export function getSafeCollapsedGroups(mapId?: string): string[] {
  const specificKey = mapId ? `jagalog_map_view_${mapId}` : "jagalog_map_collapsed_groups";
  return safeGetJSON<string[]>(specificKey, [], isStringArray);
}

/**
 * Simpan daftar grup terlipat untuk peta tertentu secara aman
 */
export function setSafeCollapsedGroups(groupIds: string[], mapId?: string): void {
  const clean = Array.from(new Set(groupIds.filter((id) => typeof id === "string" && id.trim().length > 0)));
  safeSetJSON("jagalog_map_collapsed_groups", clean);
  if (mapId) {
    safeSetJSON(`jagalog_map_view_${mapId}`, clean);
  }
}

/**
 * Hapus preferensi grup terlipat
 */
export function clearSafeCollapsedGroups(mapId?: string): void {
  safeRemove("jagalog_map_collapsed_groups");
  if (mapId) {
    safeRemove(`jagalog_map_view_${mapId}`);
  }
}

const VALID_RENTANG = ["24j", "7h", "30h", "90h", "1t", "kustom"];
const VALID_SKALA = ["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"];

export function getSafeTimelineOptions(): { rentang: string; skala: string } {
  const rawRentang = safeGetJSON<string>("jagalog_timeline_rentang", "7h");
  const rawSkala = safeGetJSON<string>("jagalog_timeline_skala", "otomatis");

  return {
    rentang: VALID_RENTANG.includes(rawRentang) ? rawRentang : "7h",
    skala: VALID_SKALA.includes(rawSkala) ? rawSkala : "otomatis",
  };
}

export function setSafeTimelineOptions(opts: { rentang?: string; skala?: string }): void {
  if (opts.rentang && VALID_RENTANG.includes(opts.rentang)) {
    safeSetJSON("jagalog_timeline_rentang", opts.rentang);
  }
  if (opts.skala && VALID_SKALA.includes(opts.skala)) {
    safeSetJSON("jagalog_timeline_skala", opts.skala);
  }
}

