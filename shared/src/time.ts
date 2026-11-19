/**
 * Modul utilitas waktu, parser zona waktu, dan aturan clock-skew JagaLog.
 */

export interface EventTimeResolution {
  eventTime: Date; // Waktu akhir untuk kolom log_events.event_time (UTC)
  deviceTime?: string; // Waktu asli perangkat (ISO string) jika meleset > 5 menit
  clockSkewSeconds?: number; // Selisih detik (device - server) jika meleset > 5 menit
}

/**
 * Aturan tunggal penentuan event_time:
 * 1. Jika perangkat mengirim timestamp valid dan selisihnya dengan received_at <= 5 menit (300 detik),
 *    gunakan timestamp perangkat.
 * 2. Jika tidak ada, tidak valid, atau selisihnya > 5 menit (jam perangkat meleset),
 *    gunakan received_at, dan simpan parsed.device_time serta parsed.clock_skew_seconds.
 */
export function resolveEventTime(
  rawDeviceTime: Date | string | number | null | undefined,
  receivedAt: Date = new Date()
): EventTimeResolution {
  if (!rawDeviceTime) {
    return { eventTime: receivedAt };
  }

  const devDate = rawDeviceTime instanceof Date ? rawDeviceTime : new Date(rawDeviceTime);
  if (isNaN(devDate.getTime())) {
    return { eventTime: receivedAt };
  }

  const diffSeconds = Math.round((devDate.getTime() - receivedAt.getTime()) / 1000);

  // Jika selisih <= 300 detik (5 menit), jam perangkat dianggap akurat
  if (Math.abs(diffSeconds) <= 300) {
    return {
      eventTime: devDate,
    };
  }

  // Jam perangkat meleset > 5 menit: pakai waktu server, catat skew
  return {
    eventTime: receivedAt,
    deviceTime: devDate.toISOString(),
    clockSkewSeconds: diffSeconds,
  };
}

/**
 * Parsing waktu BSD RFC 3164 (Mmm dd hh:mm:ss) dengan zona waktu perangkat (default Asia/Jakarta).
 */
export function parseBsdSyslogTime(
  timeStr: string,
  timezone: string = "Asia/Jakarta",
  year: number = new Date().getFullYear()
): Date | null {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const parts = timeStr.trim().split(/\s+/);
  if (parts.length < 3) return null;

  const m = months[parts[0].toLowerCase()];
  if (!m) return null;

  const d = parts[1].padStart(2, "0");
  const time = parts[2];

  let tzOffset = "+07:00"; // Default WIB
  if (timezone === "UTC") tzOffset = "Z";
  else if (timezone === "Asia/Makassar") tzOffset = "+08:00";
  else if (timezone === "Asia/Jayapura") tzOffset = "+09:00";
  else {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      });
      const formatted = formatter.format(now);
      const match = formatted.match(/GMT([+-]\d{2}:\d{2})/);
      if (match) tzOffset = match[1];
    } catch {
      tzOffset = "+07:00";
    }
  }

  const isoStr = `${year}-${m}-${d}T${time}${tzOffset}`;
  const dt = new Date(isoStr);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Format selisih jam manusiawi untuk tooltip peringatan clock skew.
 * Contoh: "3 jam 51 menit" atau "2 hari 4 jam"
 */
export function formatClockSkewDescription(diffSeconds: number): string {
  const absSec = Math.abs(diffSeconds);
  const days = Math.floor(absSec / 86400);
  const hours = Math.floor((absSec % 86400) / 3600);
  const minutes = Math.floor((absSec % 3600) / 60);
  const seconds = absSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  if (minutes > 0) parts.push(`${minutes} menit`);
  if (parts.length === 0 || (days === 0 && hours === 0 && minutes < 2)) {
    parts.push(`${seconds} detik`);
  }

  if (diffSeconds === 0) {
    return "0 detik";
  }

  const direction = diffSeconds > 0 ? "lebih cepat" : "lebih lambat";
  return `${parts.join(" ")} ${direction}`;
}
