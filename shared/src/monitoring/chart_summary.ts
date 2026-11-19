/**
 * Helper terpusat untuk kalkulasi ringkasan grafik aktivitas volume log per jam (24 jam terakhir)
 * Mengikuti aturan Bagian A (A1 & A2) optimasi_waktu_akses.md:
 * - Zona waktu Asia/Jakarta (WIB, UTC+7) konsisten; batas jam 00 menit WIB.
 * - Jam parsial (jam pertama bila belum penuh dan jam berjalan) TIDAK dihitung dalam rata-rata.
 * - Aturan penjelasan otomatis satu kalimat di bawah grafik (tanpa AI).
 */

export interface HourlySeverityCounts {
  critical: number;
  error: number;
  warning: number;
  notice: number;
  info: number;
  debug: number;
}

export interface HourlyTopDevice {
  id: string;
  name: string;
  count: number;
}

export interface HourlyBucketData {
  mulai: string; // ISO string
  selesai: string; // ISO string
  hour: string; // "HH:00"
  fullTime: string; // "YYYY-MM-DD HH:00"
  labelWib: string; // "HH.00"
  rentangWib: string; // "01.00-02.00 WIB"
  tanggalWib: string; // "13 Nov"
  gantiHari: boolean;
  jumlah_log: number;
  count: number; // alias backward compatibility
  jumlah_per_severity: HourlySeverityCounts;
  jumlah_perangkat_aktif: number;
  parsial: boolean;
  menitBerjalan: number;
  top_perangkat: HourlyTopDevice[];
}

export interface ChartSummaryMetrics {
  total_24j: number;
  rata_rata_per_jam: number;
  puncak: {
    jam: string;
    count: number;
    label: string;
  };
  terendah_jam_penuh: {
    jam: string;
    count: number;
    label: string;
  };
  total_periode_sebelumnya: number;
  persen_perubahan: number | null;
  penjelasan_otomatis: string;
}

const MONTH_NAMES_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
];

const DAY_NAMES_ID = [
  "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"
];

/**
 * Format timestamp ke format teks Indonesia (contoh: "Jumat, 13 Nov 2026, 01.00-02.00 WIB")
 */
export function formatHourRangeIndonesian(startIso: string, endIso: string): {
  header: string;
  rentang: string;
  hariTanggal: string;
} {
  const dStart = new Date(startIso);
  const dEnd = new Date(endIso);

  // Ambil waktu WIB menggunakan formatter Intl
  const startFmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dStart);

  const endFmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dEnd);

  const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value || "";

  const weekday = getPart(startFmt, "weekday");
  const day = getPart(startFmt, "day");
  const month = getPart(startFmt, "month");
  const year = getPart(startFmt, "year");
  const startHour = getPart(startFmt, "hour");
  const startMin = getPart(startFmt, "minute");

  const endHour = getPart(endFmt, "hour");
  const endMin = getPart(endFmt, "minute");

  const rentang = `${startHour}.${startMin}-${endHour}.${endMin === "59" ? "00" : endMin} WIB`;
  const hariTanggal = `${weekday}, ${day} ${month} ${year}`;
  const header = `${hariTanggal}, ${rentang}`;

  return { header, rentang, hariTanggal };
}

/**
 * Bangun 24 bucket jam tetap (WIB) yang berakhir di jam berjalan saat ini
 */
export function generate24HourBucketsWib(now: Date = new Date()): Array<{
  start: Date;
  end: Date;
  hourStr: string;
  fullTimeStr: string;
  labelWib: string;
  rentangWib: string;
  tanggalWib: string;
  gantiHari: boolean;
  isPartial: boolean;
  elapsedMinutes: number;
}> {
  // Hitung offset Asia/Jakarta (+7 jam dari UTC)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const wibMs = utcMs + 7 * 3600000;
  const nowWib = new Date(wibMs);

  const currentWibHourStart = new Date(nowWib);
  currentWibHourStart.setMinutes(0, 0, 0);

  const currentMinutes = nowWib.getMinutes();

  const buckets = [];

  for (let i = 23; i >= 0; i--) {
    const bucketWibStart = new Date(currentWibHourStart.getTime() - i * 3600000);
    const bucketWibEnd = new Date(bucketWibStart.getTime() + 3600000 - 1);

    // Konversi kembali ke UTC Date object
    const startUtc = new Date(bucketWibStart.getTime() - 7 * 3600000);
    const endUtc = new Date(bucketWibEnd.getTime() - 7 * 3600000);

    const hourNum = bucketWibStart.getHours();
    const hourStr = String(hourNum).padStart(2, "0") + ":00";
    const labelWib = String(hourNum).padStart(2, "0") + ".00";

    const nextHourNum = (hourNum + 1) % 24;
    const rentangWib = `${labelWib}-${String(nextHourNum).padStart(2, "0")}.00 WIB`;

    const day = bucketWibStart.getDate();
    const month = MONTH_NAMES_ID[bucketWibStart.getMonth()];
    const tanggalWib = `${day} ${month}`;

    const year = bucketWibStart.getFullYear();
    const monthNum = String(bucketWibStart.getMonth() + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const fullTimeStr = `${year}-${monthNum}-${dayStr} ${hourStr}`;

    const isCurrentHour = i === 0;
    // Jam berjalan adalah parsial jika menit belum 60
    const isPartial = isCurrentHour;
    const elapsedMinutes = isCurrentHour ? Math.max(1, currentMinutes) : 60;

    buckets.push({
      start: startUtc,
      end: endUtc,
      hourStr,
      fullTimeStr,
      labelWib,
      rentangWib,
      tanggalWib,
      gantiHari: hourNum === 0 || i === 23,
      isPartial,
      elapsedMinutes,
    });
  }

  return buckets;
}

/**
 * Hitung metrik ringkasan kartu dan buat kalimat penjelasan otomatis (aturan, bukan AI)
 */
export function computeChartSummary(
  buckets: HourlyBucketData[],
  totalPrevious24h: number = 0
): ChartSummaryMetrics {
  const total_24j = buckets.reduce((sum, b) => sum + b.jumlah_log, 0);

  // Jam penuh saja untuk rata-rata dan terendah
  const fullHourBuckets = buckets.filter((b) => !b.parsial);
  const sumFull = fullHourBuckets.reduce((sum, b) => sum + b.jumlah_log, 0);
  const rata_rata_per_jam =
    fullHourBuckets.length > 0 ? Math.round(sumFull / fullHourBuckets.length) : 0;

  // Puncak (dari seluruh jam)
  let maxBucket = buckets[0] || null;
  for (const b of buckets) {
    if (!maxBucket || b.jumlah_log > maxBucket.jumlah_log) {
      maxBucket = b;
    }
  }

  const puncak = {
    jam: maxBucket ? maxBucket.rentangWib : "-",
    count: maxBucket ? maxBucket.jumlah_log : 0,
    label: maxBucket
      ? `${maxBucket.jumlah_log.toLocaleString("id-ID")} log, ${maxBucket.rentangWib}`
      : "-",
  };

  // Terendah (hanya dari jam penuh)
  let minBucket = fullHourBuckets[0] || null;
  for (const b of fullHourBuckets) {
    if (!minBucket || b.jumlah_log < minBucket.jumlah_log) {
      minBucket = b;
    }
  }

  const terendah_jam_penuh = {
    jam: minBucket ? minBucket.rentangWib : "-",
    count: minBucket ? minBucket.jumlah_log : 0,
    label: minBucket
      ? `${minBucket.jumlah_log.toLocaleString("id-ID")} log, ${minBucket.rentangWib}`
      : "-",
  };

  const persen_perubahan =
    totalPrevious24h > 0
      ? Number((((total_24j - totalPrevious24h) / totalPrevious24h) * 100).toFixed(1))
      : null;

  // Penjelasan otomatis (1 kalimat berbasis aturan terpusat):
  let penjelasan_otomatis = "";

  if (total_24j === 0) {
    penjelasan_otomatis = "Belum ada log pada 24 jam terakhir.";
  } else if (rata_rata_per_jam > 0 && maxBucket && maxBucket.jumlah_log >= 2 * rata_rata_per_jam) {
    const ratio = (maxBucket.jumlah_log / rata_rata_per_jam).toFixed(1).replace(".", ",");
    const jamMulai = maxBucket.labelWib;
    const topDev = maxBucket.top_perangkat[0]?.name;
    if (topDev) {
      penjelasan_otomatis = `Ada lonjakan ${ratio}x pada pukul ${jamMulai} dari ${topDev}. Periksa Event Log.`;
    } else {
      penjelasan_otomatis = `Ada lonjakan ${ratio}x pada pukul ${jamMulai}. Periksa Event Log.`;
    }
  } else {
    // Cek apakah ada jam kosong di antara jam penuh
    const zeroIndex = fullHourBuckets.findIndex((b) => b.jumlah_log === 0);
    if (zeroIndex !== -1) {
      // Temukan rentang jam kosong
      let endZero = zeroIndex;
      while (
        endZero + 1 < fullHourBuckets.length &&
        fullHourBuckets[endZero + 1].jumlah_log === 0
      ) {
        endZero++;
      }
      const startHour = fullHourBuckets[zeroIndex].labelWib;
      const endHour = fullHourBuckets[endZero].rentangWib.split("-")[1].split(" ")[0];
      penjelasan_otomatis = `Tidak ada log pada pukul ${startHour}-${endHour}.`;
    } else {
      const jamMulai = maxBucket ? maxBucket.labelWib : "00.00";
      const countFormatted = maxBucket ? maxBucket.jumlah_log.toLocaleString("id-ID") : "0";
      penjelasan_otomatis = `Volume stabil, tertinggi pukul ${jamMulai} (${countFormatted} log).`;
    }
  }

  return {
    total_24j,
    rata_rata_per_jam,
    puncak,
    terendah_jam_penuh,
    total_periode_sebelumnya: totalPrevious24h,
    persen_perubahan,
    penjelasan_otomatis,
  };
}

