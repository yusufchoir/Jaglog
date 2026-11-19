import { redis } from "./redis";

export type IngestRejectionReason =
  | "nonaktif"
  | "ip_tidak_terdaftar"
  | "token_salah"
  | "rate_limit"
  | "ukuran"
  | "tidak_terbaca";

export const INGEST_REJECTION_REASONS: IngestRejectionReason[] = [
  "nonaktif",
  "ip_tidak_terdaftar",
  "token_salah",
  "rate_limit",
  "ukuran",
  "tidak_terbaca",
];

export const INGEST_REJECTION_LABELS: Record<IngestRejectionReason, string> = {
  nonaktif: "perangkat nonaktif",
  ip_tidak_terdaftar: "IP pengirim tidak terdaftar",
  token_salah: "token autentikasi salah atau tidak valid",
  rate_limit: "melebihi batas laju pengiriman (rate limit)",
  ukuran: "ukuran pesan terlalu besar",
  tidak_terbaca: "format pesan tidak terbaca",
};

export interface DeviceLastPacketInfo {
  timestamp: string;
  sourceIp: string;
  transport: "syslog" | "http";
  accepted: boolean;
  reason?: IngestRejectionReason | null;
  reasonLabel?: string | null;
}

export interface UnknownSourceEntry {
  ip: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface DeviceIngestDiagnostics {
  lastPacket: DeviceLastPacketInfo | null;
  rejected24h: Record<IngestRejectionReason, number>;
  rejections24h: Record<IngestRejectionReason, number>;
  totalRejected24h: number;
}

const HOURLY_REJECT_TTL_SECONDS = 48 * 3600; // 48 jam
const LAST_PACKET_TTL_SECONDS = 7 * 86400; // 7 hari
export const UNKNOWN_SOURCES_KEY = "ingest:unknown_sources";
export const UNKNOWN_SOURCES_MAX_ENTRIES = 100;
export const MAX_UNKNOWN_SOURCES = 100;
export const UNKNOWN_SOURCES_TTL_SECONDS = 86400; // 24 jam

// Throttle pencatatan paket sukses di memori agar tidak membebani Redis saat trafik tinggi
const lastAcceptedUpdateMap = new Map<string, number>();
const lastPacketStateRejected = new Map<string, boolean>();

export function normalizeSourceIp(ip: string): string {
  if (!ip) return "unknown";
  const trimmed = ip.trim();
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function getHourBucketKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13); // Contoh: "2026-11-14T15"
}

export function getLast24HourKeys(now: Date = new Date()): string[] {
  const keys: string[] = [];
  const baseMs = now.getTime();
  for (let i = 0; i < 24; i++) {
    const d = new Date(baseMs - i * 3600_000);
    keys.push(getHourBucketKey(d));
  }
  return keys;
}

const RECORD_UNKNOWN_SOURCE_LUA = `
redis.call("INCR", KEYS[2])
local existing = redis.call("HGET", KEYS[1], ARGV[1])
if existing then
  local ok, data = pcall(cjson.decode, existing)
  if ok and type(data) == "table" then
    data.count = (tonumber(data.count) or 0) + 1
    data.lastSeen = ARGV[2]
    redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(data))
    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
    return 1
  end
end
local currentLen = redis.call("HLEN", KEYS[1])
if currentLen < tonumber(ARGV[3]) then
  local data = {
    ip = ARGV[1],
    count = 1,
    firstSeen = ARGV[2],
    lastSeen = ARGV[2]
  }
  redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(data))
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
  return 1
end
return 0
`;

/**
 * Catat sumber IP tidak dikenal dengan batas ketat <= 100 entri dan TTL 24 jam.
 * Tidak pernah menyimpan isi pesan mentah (aman terhadap spoofing & banjir UDP).
 */
export async function recordBoundedUnknownSource(sourceIp: string): Promise<boolean> {
  const cleanIp = normalizeSourceIp(sourceIp);
  if (!cleanIp || cleanIp === "unknown") return false;

  const nowIso = new Date().toISOString();
  try {
    const res = await redis.eval(
      RECORD_UNKNOWN_SOURCE_LUA,
      2,
      UNKNOWN_SOURCES_KEY,
      "metrics:unknown_sources:total",
      cleanIp,
      nowIso,
      String(UNKNOWN_SOURCES_MAX_ENTRIES),
      String(UNKNOWN_SOURCES_TTL_SECONDS)
    );
    return Number(res) === 1;
  } catch {
    return false;
  }
}

/**
 * Catat penolakan paket log per alasan (per perangkat dan global, agregat per jam di Redis dengan TTL).
 * Sekaligus mencatat paket terakhir yang diterima perangkat tersebut.
 */
export async function recordIngestRejection(params: {
  reason: IngestRejectionReason;
  deviceId?: string | null;
  sourceIp?: string | null;
  transport?: "syslog" | "http";
}): Promise<void> {
  const { reason, deviceId, sourceIp, transport = "syslog" } = params;
  const cleanIp = normalizeSourceIp(sourceIp || "unknown");
  const now = new Date();
  const nowIso = now.toISOString();
  const hourKey = getHourBucketKey(now);
  const globalHashKey = `ingest:reject:global:${hourKey}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.hincrby(globalHashKey, reason, 1);
    pipeline.expire(globalHashKey, HOURLY_REJECT_TTL_SECONDS);

    if (deviceId) {
      const devHashKey = `ingest:reject:dev:${deviceId}:${hourKey}`;
      const lastPktKey = `ingest:last_pkt:${deviceId}`;
      const pktInfo: DeviceLastPacketInfo = {
        timestamp: nowIso,
        sourceIp: cleanIp,
        transport,
        accepted: false,
        reason,
        reasonLabel: INGEST_REJECTION_LABELS[reason] || reason,
      };
      pipeline.hincrby(devHashKey, reason, 1);
      pipeline.expire(devHashKey, HOURLY_REJECT_TTL_SECONDS);
      pipeline.set(lastPktKey, JSON.stringify(pktInfo), "EX", LAST_PACKET_TTL_SECONDS);
      lastPacketStateRejected.set(deviceId, true);
    }

    await pipeline.exec();

    if (reason === "ip_tidak_terdaftar" && cleanIp !== "unknown") {
      await recordBoundedUnknownSource(cleanIp);
    }
  } catch {
    // Fail-safe: jangan lempar error jika Redis sedang sibuk
  }
}

/**
 * Catat paket terakhir yang berhasil diterima oleh perangkat.
 */
export async function recordDevicePacketAccepted(
  deviceId: string,
  sourceIp: string,
  transport: "syslog" | "http" = "syslog"
): Promise<void> {
  const nowMs = Date.now();
  const wasRejected = lastPacketStateRejected.get(deviceId) === true;
  const lastUpdate = lastAcceptedUpdateMap.get(deviceId) || 0;

  // Jika sebelumnya tidak ditolak dan baru saja diupdate < 1 detik lalu, lewati tulis Redis
  if (!wasRejected && nowMs - lastUpdate < 1000) {
    return;
  }

  lastAcceptedUpdateMap.set(deviceId, nowMs);
  lastPacketStateRejected.set(deviceId, false);

  const cleanIp = normalizeSourceIp(sourceIp);
  const pktInfo: DeviceLastPacketInfo = {
    timestamp: new Date(nowMs).toISOString(),
    sourceIp: cleanIp,
    transport,
    accepted: true,
    reason: null,
    reasonLabel: null,
  };

  try {
    await redis.set(
      `ingest:last_pkt:${deviceId}`,
      JSON.stringify(pktInfo),
      "EX",
      LAST_PACKET_TTL_SECONDS
    );
  } catch {
    // Abaikan jika Redis gagal
  }
}

/**
 * Ambil diagnostik penerimaan log untuk satu perangkat (paket terakhir & agregat penolakan 24 jam).
 */
export async function getDeviceIngestDiagnostics(
  deviceId: string
): Promise<DeviceIngestDiagnostics> {
  const emptyRejected: Record<IngestRejectionReason, number> = {
    nonaktif: 0,
    ip_tidak_terdaftar: 0,
    token_salah: 0,
    rate_limit: 0,
    ukuran: 0,
    tidak_terbaca: 0,
  };

  try {
    const hourKeys = getLast24HourKeys();
    const pipeline = redis.pipeline();
    pipeline.get(`ingest:last_pkt:${deviceId}`);
    for (const hk of hourKeys) {
      pipeline.hgetall(`ingest:reject:dev:${deviceId}:${hk}`);
    }

    const results = await pipeline.exec();
    if (!results) {
      return { lastPacket: null, rejected24h: emptyRejected, rejections24h: emptyRejected, totalRejected24h: 0 };
    }

    let lastPacket: DeviceLastPacketInfo | null = null;
    const rawLastPkt = results[0]?.[1] as string | null;
    if (rawLastPkt) {
      try {
        lastPacket = JSON.parse(rawLastPkt) as DeviceLastPacketInfo;
      } catch {
        lastPacket = null;
      }
    }

    let totalRejected24h = 0;
    for (let i = 1; i < results.length; i++) {
      const hashObj = results[i]?.[1] as Record<string, string> | null;
      if (hashObj && typeof hashObj === "object") {
        for (const reason of INGEST_REJECTION_REASONS) {
          const val = parseInt(hashObj[reason] || "0", 10);
          if (val > 0) {
            emptyRejected[reason] += val;
            totalRejected24h += val;
          }
        }
      }
    }

    return {
      lastPacket,
      rejected24h: emptyRejected,
      rejections24h: emptyRejected,
      totalRejected24h,
    };
  } catch {
    return { lastPacket: null, rejected24h: emptyRejected, rejections24h: emptyRejected, totalRejected24h: 0 };
  }
}

/**
 * Ambil ringkasan penolakan global selama 24 jam terakhir.
 */
export async function getGlobalIngestRejections24h(): Promise<
  Record<IngestRejectionReason, number> & {
    byReason: Record<IngestRejectionReason, number>;
    total: number;
  }
> {
  const byReason: Record<IngestRejectionReason, number> = {
    nonaktif: 0,
    ip_tidak_terdaftar: 0,
    token_salah: 0,
    rate_limit: 0,
    ukuran: 0,
    tidak_terbaca: 0,
  };

  try {
    const hourKeys = getLast24HourKeys();
    const pipeline = redis.pipeline();
    for (const hk of hourKeys) {
      pipeline.hgetall(`ingest:reject:global:${hk}`);
    }
    const results = await pipeline.exec();
    let total = 0;
    if (results) {
      for (const [, hashObj] of results) {
        if (hashObj && typeof hashObj === "object") {
          const rec = hashObj as Record<string, string>;
          for (const reason of INGEST_REJECTION_REASONS) {
            const val = parseInt(rec[reason] || "0", 10);
            if (val > 0) {
              byReason[reason] += val;
              total += val;
            }
          }
        }
      }
    }
    return { ...byReason, byReason, total };
  } catch {
    return { ...byReason, byReason, total: 0 };
  }
}

/**
 * Ambil daftar sumber IP tidak dikenal (maks 100 entri, urut waktu terakhir terbaru).
 */
export async function getUnknownSourcesList(): Promise<UnknownSourceEntry[]> {
  try {
    const rawHash = await redis.hgetall(UNKNOWN_SOURCES_KEY);

    const cutoffMs = Date.now() - UNKNOWN_SOURCES_TTL_SECONDS * 1000;
    const items: UnknownSourceEntry[] = [];
    const expiredIps: string[] = [];

    if (rawHash && typeof rawHash === "object") {
      for (const [ip, jsonStr] of Object.entries(rawHash)) {
        try {
          const parsed = JSON.parse(jsonStr) as UnknownSourceEntry;
          const lastSeenMs = new Date(parsed.lastSeen).getTime();
          if (!isNaN(lastSeenMs) && lastSeenMs >= cutoffMs) {
            items.push({
              ip: parsed.ip || ip,
              count: Number(parsed.count) || 1,
              firstSeen: parsed.firstSeen || parsed.lastSeen,
              lastSeen: parsed.lastSeen,
            });
          } else {
            expiredIps.push(ip);
          }
        } catch {
          expiredIps.push(ip);
        }
      }
    }

    if (expiredIps.length > 0) {
      redis.hdel(UNKNOWN_SOURCES_KEY, ...expiredIps).catch(() => {});
    }

    items.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    return items.slice(0, UNKNOWN_SOURCES_MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Hapus satu IP dari daftar sumber tidak dikenal (misal setelah didaftarkan/dipasangkan oleh admin).
 */
export async function removeUnknownSourceIp(ip: string): Promise<void> {
  const cleanIp = normalizeSourceIp(ip);
  if (!cleanIp) return;
  try {
    await redis.hdel(UNKNOWN_SOURCES_KEY, cleanIp);
    await redis.del("cache:admin:diagnostik");
  } catch {
    // Abaikan jika gagal
  }
}
