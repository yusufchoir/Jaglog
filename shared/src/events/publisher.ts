import { redis } from "../redis";

export const CHANGES_CHANNEL = "jagalog:changes";
export const RECENT_EVENTS_KEY = "jagalog:recent_events";
export const RECENT_EVENTS_TTL_SECONDS = 60;
export const MAX_RECENT_EVENTS = 500;

export type ChangeEventType =
  | "log.baru"
  | "perangkat.status"
  | "perangkat.ping"
  | "perangkat.diubah"
  | "insiden.berubah"
  | "analisa.selesai"
  | "statistik.diperbarui"
  | "pengiriman_log.berubah"
  | "peta.berubah"
  | "grup.berubah";

export interface ChangeEvent {
  id: string; // e.g. "evt_1731000000000_1"
  tipe: ChangeEventType;
  perangkat_id: string | null;
  versi: number;
  waktu: string; // ISO string
  clientId?: string;
  data_ringkas?: {
    id_log_terakhir?: number;
    jumlah?: number;
    id_insiden?: string;
    status?: string;
    rentang_jam?: string;
    ping_ok?: boolean;
    ping_rtt?: number | null;
    status_perangkat?: string;
    [key: string]: any;
  };
}

let eventCounter = 0;

export function generateEventId(): string {
  eventCounter = (eventCounter + 1) % 1000000;
  return `evt_${Date.now()}_${eventCounter}`;
}

// Coalescing map for high-frequency events (e.g., log.baru)
// Key: `${perangkat_id}:${tipe}`
interface CoalescedEventState {
  perangkat_id: string | null;
  tipe: ChangeEventType;
  firstTime: number;
  lastTime: number;
  count: number;
  lastLogId?: number;
  data_ringkas?: Record<string, any>;
  timer: NodeJS.Timeout | null;
}

const coalescedMap = new Map<string, CoalescedEventState>();
const COALESCE_WINDOW_MS = 1000; // 1-2 detik window

/**
 * Kirim langsung event ke Redis pub/sub dan simpan ke buffer Last-Event-ID
 */
export async function directPublish(event: ChangeEvent): Promise<void> {
  // Cek environment toggle
  if (process.env.LIVE_UPDATES === "false") {
    return;
  }

  const payload = JSON.stringify(event);

  try {
    // 1. Simpan di buffer recent events (Redis sorted set berdasar timestamp untuk Last-Event-ID)
    const score = Date.now();
    const multi = redis.multi();
    multi.zadd(RECENT_EVENTS_KEY, score, payload);
    // Hapus event yang lebih tua dari 60 detik
    multi.zremrangebyscore(RECENT_EVENTS_KEY, "-inf", score - RECENT_EVENTS_TTL_SECONDS * 1000);
    // Batasi maksimum 500 event
    multi.zremrangebyrank(RECENT_EVENTS_KEY, 0, -(MAX_RECENT_EVENTS + 1));
    multi.expire(RECENT_EVENTS_KEY, RECENT_EVENTS_TTL_SECONDS * 2);
    // Publish ke pub/sub
    multi.publish(CHANGES_CHANNEL, payload);

    await multi.exec();
  } catch (err) {
    // Gagal publish tidak boleh mengganggu worker/ingest
    console.error("[EventsPublisher] Gagal menerbitkan event ke Redis:", err);
  }
}

/**
 * Flush satu grup coalesced event
 */
function flushCoalesced(key: string) {
  const item = coalescedMap.get(key);
  if (!item) return;
  coalescedMap.delete(key);

  const event: ChangeEvent = {
    id: generateEventId(),
    tipe: item.tipe,
    perangkat_id: item.perangkat_id,
    versi: Date.now(),
    waktu: new Date().toISOString(),
    data_ringkas: {
      ...item.data_ringkas,
      jumlah: item.count,
      ...(item.lastLogId !== undefined ? { id_log_terakhir: item.lastLogId } : {}),
    },
  };

  directPublish(event).catch((e) => {
    console.error("[EventsPublisher] Error pada flushCoalesced:", e);
  });
}

/**
 * Fungsi utama untuk mempublikasikan perubahan.
 * Untuk "log.baru", dilakukan coalescing per (perangkat, tipe) dalam 1-2 detik.
 * Untuk event status/insiden/analisa, langsung diterbitkan tanpa delay.
 */
export async function publishChange(eventInput: Omit<ChangeEvent, "id" | "versi" | "waktu"> & {
  id?: string;
  versi?: number;
  waktu?: string;
}): Promise<void> {
  try {
    const tipe = eventInput.tipe;
    const perangkatId = eventInput.perangkat_id || null;

    // Coalesce hanya untuk event frekuensi sangat tinggi: log.baru
    if (tipe === "log.baru") {
      const key = `${perangkatId ?? "global"}:${tipe}`;
      const existing = coalescedMap.get(key);
      const now = Date.now();
      const incCount = eventInput.data_ringkas?.jumlah ?? 1;
      const incomingLastLogId = eventInput.data_ringkas?.id_log_terakhir;

      if (existing) {
        existing.count += incCount;
        existing.lastTime = now;
        if (incomingLastLogId !== undefined) {
          existing.lastLogId = Math.max(existing.lastLogId ?? 0, incomingLastLogId);
        }
        // Biarkan timer yang ada berjalan sampai jendela selesai
        return;
      }

      // Buat entri baru dan pasang timer flush 1 detik
      const newState: CoalescedEventState = {
        perangkat_id: perangkatId,
        tipe,
        firstTime: now,
        lastTime: now,
        count: incCount,
        lastLogId: incomingLastLogId,
        data_ringkas: eventInput.data_ringkas,
        timer: setTimeout(() => {
          flushCoalesced(key);
        }, COALESCE_WINDOW_MS),
      };
      if (newState.timer && typeof newState.timer.unref === "function") {
        newState.timer.unref();
      }

      coalescedMap.set(key, newState);
      return;
    }

    // Untuk event selain log.baru (status, ping, insiden, analisa, dll), langsung kirim
    const fullEvent: ChangeEvent = {
      id: eventInput.id || generateEventId(),
      tipe: eventInput.tipe,
      perangkat_id: perangkatId,
      versi: eventInput.versi || Date.now(),
      waktu: eventInput.waktu || new Date().toISOString(),
      clientId: eventInput.clientId,
      data_ringkas: eventInput.data_ringkas,
    };

    await directPublish(fullEvent);
  } catch (err) {
    console.error("[EventsPublisher] Gagal publishChange:", err);
  }
}

/**
 * Ambil event yang terlewat sejak ID terakhir (untuk Last-Event-ID)
 */
export async function getEventsSince(
  lastEventId: string | null,
  maxAgeMs = 60000
): Promise<ChangeEvent[]> {
  try {
    const minScore = Date.now() - maxAgeMs;
    const rawEvents = await redis.zrangebyscore(RECENT_EVENTS_KEY, minScore, "+inf");
    if (!rawEvents || rawEvents.length === 0) return [];

    const events: ChangeEvent[] = [];
    let foundLast = !lastEventId;

    for (const raw of rawEvents) {
      try {
        const parsed = JSON.parse(raw) as ChangeEvent;
        if (!foundLast) {
          if (parsed.id === lastEventId) {
            foundLast = true;
          }
          continue;
        }
        events.push(parsed);
      } catch {
        // Skip corrupted JSON
      }
    }

    // Jika lastEventId diberikan tetapi tidak ditemukan di buffer 60 detik (sudah kadaluarsa)
    if (lastEventId && !foundLast) {
      // Return empty array with a special sign or handled by caller as "resync"
      return [];
    }

    return events;
  } catch (err) {
    console.error("[EventsPublisher] getEventsSince error:", err);
    return [];
  }
}

export const publishChangeImmediately = publishChange;
