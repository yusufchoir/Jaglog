import { z } from "zod";

export type RentangOption = "24j" | "7h" | "30h" | "90h" | "1t" | "kustom";
export type SkalaOption = "otomatis" | "15m" | "30m" | "1j" | "4j" | "6j" | "1h" | "1m" | "1b";
export type ConcreteSkalaOption = Exclude<SkalaOption, "otomatis">;

export const TIMELINE_THRESHOLDS = {
  LEQ_1H_SECONDS: 60, // skala <= 1 jam: ambang 1 menit (60 detik)
  HOURS_4_6_PCT: 0.02, // 4-6 jam: 2% dari durasi slot
  DAY_1_PCT: 0.01, // 1 hari: 1% dari durasi slot
  WEEK_MONTH_PCT: 0.005, // 1 minggu & 1 bulan: 0.5% dari durasi slot
  NO_DATA_PCT: 0.5, // detik_tanpa_data >= 50% slot -> "Belum Ada Data"
} as const;

export interface StatusSlot {
  mulai: string; // ISO string
  selesai: string; // ISO string
  status: "online" | "log_stopped" | "offline" | "unknown";
  uptime_persen: number | null; // null if no data
  detik_online: number;
  detik_log_berhenti: number;
  detik_offline: number;
  detik_tanpa_data: number;
  jumlah_gangguan: number;
  sebagian?: boolean;
  gangguan: Array<{
    mulai: string;
    selesai: string;
    durasi_detik: number;
    status: string;
  }>;
}

export interface TimelineRingkasan {
  uptime_persen: number | null;
  total_downtime_detik: number;
  jumlah_gangguan: number;
  gangguan_terlama_detik: number;
  cakupan_data_persen: number;
  keterangan_cakupan?: string;
  total_durasi_tercakup_detik: number;
  total_durasi_rentang_detik: number;
}

export interface PingServerSlot {
  mulai: string; // ISO
  selesai: string; // ISO
  status: "up" | "sebagian" | "down" | "unknown";
  cek_total: number;
  cek_gagal: number;
  persen_sukses: number | null;
  rtt_rata_ms: number | null;
  gagal_terpanjang_detik: number;
  sebagian_slot?: boolean;
  kejadian_down?: Array<{
    mulai: string;
    selesai: string;
    durasi_detik: number;
  }>;
}

export interface PingRingkasan {
  persen_up: number | null;
  jumlah_down: number;
  down_terlama_detik: number;
}

export interface LogDeliverySlot {
  mulai: string; // ISO
  selesai: string; // ISO
  status: "mengirim" | "sebagian" | "tidak_mengirim" | "unknown";
  jumlah_log: number;
  celah_terpanjang_detik: number;
  sebagian_slot?: boolean;
  periode_tidak_mengirim?: Array<{
    mulai: string;
    selesai: string;
    durasi_detik: number;
  }>;
}

export interface LogDeliveryRingkasan {
  persen_mengirim: number | null;
  jumlah_periode_tidak_mengirim: number;
  tidak_mengirim_terlama_detik: number;
  log_terakhir_pada: string | null;
}

export interface TimelineResponse {
  rentang: RentangOption;
  skala: SkalaOption;
  skala_terpilih: ConcreteSkalaOption;
  slot_terpilih_skala: string;
  dari: string;
  sampai: string;
  ringkasan: TimelineRingkasan;
  slots: StatusSlot[];
  ping?: {
    aktif: boolean;
    slot: PingServerSlot[];
    ringkasan: PingRingkasan;
  };
  pengiriman_log?: {
    slot: LogDeliverySlot[];
    ringkasan: LogDeliveryRingkasan;
  };
  section_status?: {
    status_utama: "ok" | "gagal" | "tanpa_data";
    ping: "ok" | "gagal" | "tanpa_data";
    pengiriman_log: "ok" | "gagal" | "tanpa_data";
    ringkasan: "ok" | "gagal" | "tanpa_data";
  };
}

// Skala per rentang yang diizinkan (kandidat)
export const VALID_RENTANG_SKALA: Record<RentangOption, SkalaOption[]> = {
  "24j": ["otomatis", "15m", "30m", "1j"],
  "7h": ["otomatis", "4j", "6j"],
  "30h": ["otomatis", "1h"],
  "90h": ["otomatis", "1h", "1m"],
  "1t": ["otomatis", "1m", "1b"],
  kustom: ["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"],
};

export const DEFAULT_SKALA_MAP: Record<RentangOption, ConcreteSkalaOption> = {
  "24j": "30m",
  "7h": "4j",
  "30h": "1h",
  "90h": "1h",
  "1t": "1m",
  kustom: "1h",
};

export const SCALE_ORDER: ConcreteSkalaOption[] = [
  "15m",
  "30m",
  "1j",
  "4j",
  "6j",
  "1h",
  "1m",
  "1b",
];

export const SCALE_LABEL_MAP: Record<string, string> = {
  otomatis: "Otomatis",
  "15m": "15 menit",
  "30m": "30 menit",
  "1j": "1 jam",
  "4j": "4 jam",
  "6j": "6 jam",
  "1h": "1 hari",
  "1m": "1 minggu",
  "1b": "1 bulan",
};

// UTC+7 (Asia/Jakarta) offset
const WIB_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Parse input string tanggal ke objek Date zona Asia/Jakarta (WIB, UTC+7).
 * - "dari" (isEndOfDay=false) dinormalisasi ke awal hari 00:00:00.000 WIB
 * - "sampai" (isEndOfDay=true) dinormalisasi ke akhir hari 23:59:59.999 WIB
 */
export function parseWibDateInput(str: string, isEndOfDay: boolean): Date {
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    const timePart = isEndOfDay ? "23:59:59.999" : "00:00:00.000";
    return new Date(`${y}-${m}-${d}T${timePart}+07:00`);
  }
  return new Date(trimmed);
}

/**
 * Konversi Date ke string YYYY-MM-DD dalam zona Asia/Jakarta (WIB)
 */
export function getWibDateString(date: Date = new Date()): string {
  const wibMs = date.getTime() + WIB_OFFSET_MS;
  const d = new Date(wibMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Zod schema untuk validasi parameter query
 */
export const timelineQuerySchema = z
  .object({
    rentang: z.enum(["24j", "7h", "30h", "90h", "1t", "kustom"], {
      errorMap: () => ({ message: "Pilihan rentang tidak valid." }),
    }),
    skala: z
      .enum(["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"])
      .default("otomatis"),
    dari: z.string().optional(),
    sampai: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rentang === "kustom") {
      if (!data.dari || !data.sampai) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pilih tanggal awal dan akhir.",
        });
        return;
      }
      const start = parseWibDateInput(data.dari, false);
      const end = parseWibDateInput(data.sampai, true);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Format tanggal tidak valid.",
        });
        return;
      }

      if (start.getTime() > end.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tanggal akhir harus sama dengan atau setelah tanggal awal.",
        });
        return;
      }

      // Rentang kustom maksimal 400 hari
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
      if (diffDays > 400) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rentang maksimal 400 hari. Persempit pilihan tanggalnya.",
        });
        return;
      }
    }
  });

/**
 * Format durasi manusiawi dalam bahasa Indonesia
 */
export function formatDurationHuman(seconds: number): string {
  if (seconds <= 0) return "0 detik";
  if (seconds < 60) return `${Math.round(seconds)} detik`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours} jam ${remMinutes} menit` : `${hours} jam`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
}

/**
 * Format pilihan skala valid ke kalimat bahasa Indonesia (misal: "30 menit atau 1 jam")
 */
export function formatScaleChoices(scales: ConcreteSkalaOption[]): string {
  const labels = scales.map((s) => SCALE_LABEL_MAP[s] || s);
  if (labels.length === 0) return "skala Otomatis";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} atau ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, atau ${labels[labels.length - 1]}`;
}

/**
 * Dapatkan rentang tanggal konkret (start, end) berdasarkan opsi rentang
 */
export function resolveDateRange(
  rentang: RentangOption,
  customDari?: string,
  customSampai?: string,
  referenceNow: Date = new Date()
): { start: Date; end: Date } {
  let end: Date = referenceNow;
  let start: Date;

  switch (rentang) {
    case "24j":
      start = new Date(end.getTime() - 24 * 3600 * 1000);
      break;
    case "7h":
      start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
      break;
    case "30h":
      start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
      break;
    case "90h":
      start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
      break;
    case "1t":
      start = new Date(end.getTime() - 364 * 24 * 3600 * 1000); // 52 minggu (364 hari)
      break;
    case "kustom": {
      const parsedStart = customDari
        ? parseWibDateInput(customDari, false)
        : new Date(referenceNow.getTime() - 7 * 24 * 3600 * 1000);
      let parsedEnd = customSampai
        ? parseWibDateInput(customSampai, true)
        : referenceNow;

      // "Sampai" yang melewati waktu sekarang otomatis dipotong ke sekarang
      if (parsedEnd.getTime() > referenceNow.getTime()) {
        parsedEnd = new Date(referenceNow.getTime());
      }

      // Pastikan durasi minimal 1 menit bila dipotong ke sekarang
      if (parsedEnd.getTime() <= parsedStart.getTime()) {
        parsedEnd = new Date(parsedStart.getTime() + 60 * 1000);
      }

      start = parsedStart;
      end = parsedEnd;
      break;
    }
    default:
      start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  }

  return { start, end };
}

/**
 * Generate slot boundaries teratur (Asia/Jakarta aligned)
 */
export function generateSlotBoundaries(
  start: Date,
  end: Date,
  skala: ConcreteSkalaOption
): Array<{ start: Date; end: Date; sebagian?: boolean }> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (startMs >= endMs) return [];

  const slots: Array<{ start: Date; end: Date; sebagian?: boolean }> = [];

  if (skala === "1b") {
    const curr = new Date(startMs);
    while (curr.getTime() < endMs) {
      const s = new Date(curr);
      const nextMonth = new Date(curr);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const e = new Date(Math.min(nextMonth.getTime(), endMs));
      if (e.getTime() > s.getTime()) {
        slots.push({
          start: s,
          end: e,
          sebagian: e.getTime() < nextMonth.getTime(),
        });
      }
      curr.setTime(nextMonth.getTime());
    }
    if (slots.length > 12 && (endMs - startMs) <= 366 * 24 * 3600 * 1000) {
      return slots.slice(0, 12);
    }
    return slots;
  }

  if (skala === "1m") {
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    let curr = startMs;
    while (curr < endMs) {
      const next = Math.min(curr + WEEK_MS, endMs);
      slots.push({
        start: new Date(curr),
        end: new Date(next),
        sebagian: (next - curr) < WEEK_MS,
      });
      curr = next;
    }
    return slots;
  }

  // Fixed duration slots: 15m, 30m, 1j, 4j, 6j, 1h
  let stepMs: number;
  switch (skala) {
    case "15m":
      stepMs = 15 * 60 * 1000;
      break;
    case "30m":
      stepMs = 30 * 60 * 1000;
      break;
    case "1j":
      stepMs = 3600 * 1000;
      break;
    case "4j":
      stepMs = 4 * 3600 * 1000;
      break;
    case "6j":
      stepMs = 6 * 3600 * 1000;
      break;
    case "1h":
      stepMs = 24 * 3600 * 1000;
      break;
    default:
      stepMs = 3600 * 1000;
  }

  let curr = startMs;
  while (curr < endMs) {
    const next = Math.min(curr + stepMs, endMs);
    slots.push({
      start: new Date(curr),
      end: new Date(next),
      sebagian: (next - curr) < stepMs,
    });
    curr = next;
  }

  return slots;
}

/**
 * Menghitung jumlah slot yang benar-benar dibentuk
 */
export function calculateSlotCount(
  start: Date,
  end: Date,
  skala: ConcreteSkalaOption
): number {
  return generateSlotBoundaries(start, end, skala).length;
}

/**
 * Ambil daftar skala kandidat yang menghasilkan 12 hingga 96 slot untuk rentang tertentu.
 * Jika rentang sangat pendek (< 3 jam), izinkan skala terhalus ("15m") dengan slot < 12.
 */
export function getValidScalesForRange(
  rentang: RentangOption,
  start: Date,
  end: Date
): ConcreteSkalaOption[] {
  const candidates = VALID_RENTANG_SKALA[rentang].filter(
    (s): s is ConcreteSkalaOption => s !== "otomatis"
  );

  const valid: ConcreteSkalaOption[] = [];
  for (const scale of candidates) {
    const slotCount = calculateSlotCount(start, end, scale);
    if (slotCount >= 12 && slotCount <= 96) {
      valid.push(scale);
    }
  }

  // Jika rentang sangat pendek (tidak ada yang >= 12 slot):
  // Izinkan skala terhalus ("15m" atau yang terkecil) dengan slot <= 96
  if (valid.length === 0) {
    const shortCandidates = candidates.filter(
      (s) => calculateSlotCount(start, end, s) <= 96
    );
    if (shortCandidates.length > 0) {
      shortCandidates.sort(
        (a, b) => SCALE_ORDER.indexOf(a) - SCALE_ORDER.indexOf(b)
      );
      valid.push(shortCandidates[0]);
    }
  }

  return valid;
}

/**
 * Resolusi skala otomatis terpusat (digunakan oleh server dan UI)
 * - Menghitung jumlah slot sebenarnya dari tiap skala kandidat
 * - Memilih kandidat dengan 12 <= slotCount <= 96 yang paling dekat dengan 48
 * - Bila seri, memilih skala yang lebih halus (urutan awal di SCALE_ORDER)
 * - Jika rentang sangat pendek, memakai skala terhalus (15m) dan mengizinkan slot < 12
 * - Otomatis tidak pernah menghasilkan error jumlah slot
 */
export function resolveConcreteScale(
  rentang: RentangOption,
  requestedSkala: SkalaOption,
  start: Date,
  end: Date
): ConcreteSkalaOption {
  if (requestedSkala !== "otomatis") {
    return requestedSkala;
  }

  const candidates = VALID_RENTANG_SKALA[rentang].filter(
    (s): s is ConcreteSkalaOption => s !== "otomatis"
  );

  const candidatesWithCount = candidates.map((scale) => {
    const slotCount = calculateSlotCount(start, end, scale);
    return { scale, slotCount };
  });

  // Filter kandidat yang memenuhi 12 <= slotCount <= 96
  const eligible = candidatesWithCount.filter(
    (c) => c.slotCount >= 12 && c.slotCount <= 96
  );

  if (eligible.length > 0) {
    // Pilih yang paling dekat dengan 48. Bila seri, pilih skala yang lebih halus.
    eligible.sort((a, b) => {
      const diffA = Math.abs(a.slotCount - 48);
      const diffB = Math.abs(b.slotCount - 48);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
      return SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale);
    });
    return eligible[0].scale;
  }

  // Jika tidak ada kandidat 12..96 (misal rentang sangat pendek < 3 jam):
  // Pakai skala terhalus yang slotCount <= 96
  const shortCandidates = candidatesWithCount.filter((c) => c.slotCount <= 96);
  if (shortCandidates.length > 0) {
    shortCandidates.sort(
      (a, b) => SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale)
    );
    return shortCandidates[0].scale;
  }

  return "15m";
}

/**
 * Evaluasi status dan warna slot berdasarkan aturan ambang
 */
export function determineSlotStatus(params: {
  slotDurationSeconds: number;
  detikOnline: number;
  detikLogBerhenti: number;
  detikOffline: number;
  detikTanpaData: number;
}): "online" | "log_stopped" | "offline" | "unknown" {
  const { slotDurationSeconds, detikLogBerhenti, detikOffline, detikTanpaData } = params;

  // "Belum Ada Data": jika detik_tanpa_data >= 50% dari slot
  if (slotDurationSeconds <= 0 || detikTanpaData / slotDurationSeconds >= TIMELINE_THRESHOLDS.NO_DATA_PCT) {
    return "unknown";
  }

  // Tentukan ambang masalah berdasarkan skala/durasi slot
  let thresholdSeconds: number;
  if (slotDurationSeconds <= 3600) {
    // <= 1 jam: ambang 1 menit (60 detik)
    thresholdSeconds = TIMELINE_THRESHOLDS.LEQ_1H_SECONDS;
  } else if (slotDurationSeconds <= 6 * 3600) {
    // 4-6 jam: 2% dari durasi slot
    thresholdSeconds = slotDurationSeconds * TIMELINE_THRESHOLDS.HOURS_4_6_PCT;
  } else if (slotDurationSeconds <= 24 * 3600) {
    // 1 hari: 1% dari durasi slot
    thresholdSeconds = slotDurationSeconds * TIMELINE_THRESHOLDS.DAY_1_PCT;
  } else {
    // 1 minggu / 1 bulan: 0.5% dari durasi slot
    thresholdSeconds = slotDurationSeconds * TIMELINE_THRESHOLDS.WEEK_MONTH_PCT;
  }

  // Masalah Offline lebih prioritas daripada Log Berhenti
  if (detikOffline >= thresholdSeconds) {
    return "offline";
  }

  if (detikLogBerhenti >= thresholdSeconds) {
    return "log_stopped";
  }

  return "online";
}

export interface PingSlotEvalInput {
  slotStart: Date;
  slotEnd: Date;
  deviceCreatedAt: Date | null;
  pingEnabled: boolean;
  isDeviceActive: boolean;
  checkCount: number;
  failCount: number;
  maxConsecutiveRtoSeconds: number;
  avgLatencyMs: number | null;
  pingFailureThreshold: number;
  slotDurationSeconds: number;
  now: Date;
  sebagianSlot?: boolean;
  downEvents?: Array<{ mulai: string; selesai: string; durasi_detik: number }>;
}

/**
 * Evaluasi status slot Ping Server secara terpusat
 */
export function evaluatePingSlotStatus(input: PingSlotEvalInput): PingServerSlot {
  const {
    slotStart,
    slotEnd,
    deviceCreatedAt,
    pingEnabled,
    isDeviceActive,
    checkCount,
    failCount,
    maxConsecutiveRtoSeconds,
    avgLatencyMs,
    pingFailureThreshold,
    slotDurationSeconds,
    now,
    sebagianSlot,
    downEvents = [],
  } = input;

  const sIso = slotStart.toISOString();
  const eIso = slotEnd.toISOString();
  const devCreatedMs = deviceCreatedAt ? deviceCreatedAt.getTime() : 0;

  // 1. Belum Ada Data (abu-abu / "unknown"):
  // slot sebelum perangkat dibuat, saat ping tidak aktif, saat perangkat nonaktif,
  // atau tidak ada satu pun hasil cek di slot itu.
  if (
    !pingEnabled ||
    !isDeviceActive ||
    (devCreatedMs > 0 && slotEnd.getTime() <= devCreatedMs) ||
    checkCount === 0
  ) {
    return {
      mulai: sIso,
      selesai: eIso,
      status: "unknown",
      cek_total: checkCount,
      cek_gagal: failCount,
      persen_sukses: checkCount > 0 ? Math.round(((checkCount - failCount) / checkCount) * 1000) / 10 : null,
      rtt_rata_ms: avgLatencyMs,
      gagal_terpanjang_detik: maxConsecutiveRtoSeconds,
      sebagian_slot: sebagianSlot,
      kejadian_down: downEvents,
    };
  }

  // 2. Down (merah / "down"):
  // Ambang:
  // - skala <= 1 jam (slotDurationSeconds <= 3600):
  //   ada gagal berturut-turut >= ambang RTO perangkat (pingFailureThreshold * 30 detik)
  //   atau failCount >= pingFailureThreshold
  // - skala 4-6 jam (slotDurationSeconds <= 21600):
  //   failCount / checkCount >= 0.10 (10%)
  // - skala >= 1 hari:
  //   failCount / checkCount >= 0.05 (5%)
  let isDown = false;
  const failRatio = checkCount > 0 ? failCount / checkCount : 0;

  if (slotDurationSeconds <= 3600) {
    const thresholdSec = Math.max(30, pingFailureThreshold * 30);
    if (maxConsecutiveRtoSeconds >= thresholdSec || failCount >= pingFailureThreshold || failRatio === 1) {
      isDown = true;
    }
  } else if (slotDurationSeconds <= 6 * 3600) {
    if (failRatio >= 0.10) {
      isDown = true;
    }
  } else {
    if (failRatio >= 0.05) {
      isDown = true;
    }
  }

  let status: "up" | "sebagian" | "down" | "unknown";
  if (isDown) {
    status = "down";
  } else if (failCount > 0) {
    status = "sebagian";
  } else {
    status = "up";
  }

  const successPct = Math.min(
    100,
    Math.max(0, Math.round(((checkCount - failCount) / checkCount) * 1000) / 10)
  );

  return {
    mulai: sIso,
    selesai: eIso,
    status,
    cek_total: checkCount,
    cek_gagal: failCount,
    persen_sukses: successPct,
    rtt_rata_ms: avgLatencyMs,
    gagal_terpanjang_detik: maxConsecutiveRtoSeconds,
    sebagian_slot: sebagianSlot,
    kejadian_down: downEvents,
  };
}

export interface LogSlotEvalInput {
  slotStart: Date;
  slotEnd: Date;
  deviceCreatedAt: Date | null;
  isDeviceActive: boolean;
  hasDeviceSentLogsEver: boolean;
  receivedCount: number;
  maxGapSeconds: number;
  offlineAfterMinutes: number;
  slotDurationSeconds: number;
  now: Date;
  sebagianSlot?: boolean;
  inactivePeriods?: Array<{ mulai: string; selesai: string; durasi_detik: number }>;
}

/**
 * Evaluasi status slot Pengiriman Log secara terpusat
 */
export function evaluateLogDeliverySlotStatus(input: LogSlotEvalInput): LogDeliverySlot {
  const {
    slotStart,
    slotEnd,
    deviceCreatedAt,
    isDeviceActive,
    hasDeviceSentLogsEver,
    receivedCount,
    maxGapSeconds,
    offlineAfterMinutes,
    slotDurationSeconds,
    now,
    sebagianSlot,
    inactivePeriods = [],
  } = input;

  const sIso = slotStart.toISOString();
  const eIso = slotEnd.toISOString();
  const devCreatedMs = deviceCreatedAt ? deviceCreatedAt.getTime() : 0;
  const gapThresholdSec = offlineAfterMinutes * 60;

  // 1. Belum Ada Data (abu-abu / "unknown"):
  // slot sebelum perangkat dibuat, atau saat perangkat nonaktif.
  // Perangkat nonaktif TIDAK dihitung "tidak mengirim".
  // Jika perangkat belum pernah mengirim log sama sekali:
  if (
    !isDeviceActive ||
    (devCreatedMs > 0 && slotEnd.getTime() <= devCreatedMs) ||
    !hasDeviceSentLogsEver
  ) {
    return {
      mulai: sIso,
      selesai: eIso,
      status: "unknown",
      jumlah_log: receivedCount,
      celah_terpanjang_detik: maxGapSeconds,
      sebagian_slot: sebagianSlot,
      periode_tidak_mengirim: inactivePeriods,
    };
  }

  // Cek apakah slot sedang berjalan (current slot)
  const isCurrentSlot = now.getTime() >= slotStart.getTime() && now.getTime() < slotEnd.getTime();
  const elapsedSecInSlot = isCurrentSlot
    ? Math.max(1, Math.round((now.getTime() - slotStart.getTime()) / 1000))
    : slotDurationSeconds;

  // 2. Evaluasi status slot
  let status: "mengirim" | "sebagian" | "tidak_mengirim" | "unknown";

  if (receivedCount === 0) {
    // Slot yang sedang berjalan tidak boleh langsung merah hanya karena belum ada log di menit-menit awal;
    // jika durasi yang sudah lewat kurang dari ambang offline_after_minutes, tetap dianggap normal/mengirim
    if (isCurrentSlot && elapsedSecInSlot < gapThresholdSec) {
      status = "mengirim";
    } else {
      status = "tidak_mengirim";
    }
  } else {
    // Ada log: cek apakah ada celah diam melebihi ambang
    if (maxGapSeconds >= gapThresholdSec) {
      status = "sebagian";
    } else {
      status = "mengirim";
    }
  }

  return {
    mulai: sIso,
    selesai: eIso,
    status,
    jumlah_log: receivedCount,
    celah_terpanjang_detik: maxGapSeconds,
    sebagian_slot: sebagianSlot,
    periode_tidak_mengirim: inactivePeriods,
  };
}

