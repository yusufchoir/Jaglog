import { Worker, Job } from "bullmq";
import { INGEST_QUEUE_NAME, RawLogPayload } from "@shared/queue";
import { getRedisConnectionOptions, redis } from "@shared/redis";
import { db } from "@shared/db";
import { logEvents, devices } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { parseLog } from "@shared/parsers";
import { resolveEventTime } from "@shared/time";
import { matchFilters, subscribeFilterInvalidate } from "@shared/log-filter";
import {
  checkDeviceRateLimit,
  getPatternHash,
  isFloodProtected,
  checkAndTrackDedupe,
  registerDedupeParent,
  flushDedupeCountsToDb,
  recordPatternFrequency,
} from "@shared/dedupe";
import { recordHourlyLogBatch } from "@shared/monitoring";
import { publishChange } from "@shared/events/publisher";
import { recordIngestRejection } from "@shared/ingest-diagnostics";

const BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 1000;

export function startIngestWorker(): Worker<RawLogPayload> {
  // Subscribe ke invalidasi filter cache di Redis
  subscribeFilterInvalidate();

  const pendingBuffer: RawLogPayload[] = [];
  let flushTimeout: NodeJS.Timeout | null = null;

  // Helper untuk melakukan batch insert buffer ke database
  const flushBatch = async () => {
    if (pendingBuffer.length === 0) return;

    // Ambil semua item saat ini dari buffer
    const batchToInsert = pendingBuffer.splice(0, pendingBuffer.length);

    try {
      // 1. Filter dan pisahkan item berdasarkan rate-limit, noise filter, dan dedupe
      const toInsert: Array<{
        deviceId: string;
        receivedAt: Date;
        eventTime: Date;
        severity: number;
        facility: number;
        sourceApp: string | null;
        category: string;
        message: string;
        raw: string;
        parsed: Record<string, unknown>;
        repeatCount: number;
        firstEventTime: Date;
        patternHash: string;
      }> = [];

      const parentUpdatesMap = new Map<number, { count: number; lastTime: Date }>();

      // In-batch dedupe map untuk menangani burst pesan identik dalam batch yang sama
      const inBatchParents = new Map<string, number>(); // patternKey -> index in toInsert

      const hourlyStatsMap = new Map<
        string,
        {
          deviceId: string;
          timestamp: Date;
          received: number;
          stored: number;
          dropped: number;
          severityCritical?: number;
          severityError?: number;
          severityWarning?: number;
          severityNotice?: number;
          severityInfo?: number;
          severityDebug?: number;
        }
      >();

      for (const item of batchToInsert) {
        let stat = hourlyStatsMap.get(item.deviceId);
        if (!stat) {
          stat = {
            deviceId: item.deviceId,
            timestamp: new Date(item.receivedAt),
            received: 0,
            stored: 0,
            dropped: 0,
            severityCritical: 0,
            severityError: 0,
            severityWarning: 0,
            severityNotice: 0,
            severityInfo: 0,
            severityDebug: 0,
          };
          hourlyStatsMap.set(item.deviceId, stat);
        }
        stat.received += 1;

        // A. Cek Rate Limit per perangkat (default 200 pesan / detik)
        const rateCheck = await checkDeviceRateLimit(item.deviceId);
        if (!rateCheck.allowed) {
          // Melampaui batas laju, dibuang langsung
          stat.dropped += 1;
          recordIngestRejection({
            reason: "rate_limit",
            deviceId: item.deviceId,
            sourceIp: item.sourceIp,
            transport: "syslog",
          }).catch(() => {});
          continue;
        }

        // B. Cek Noise Filter (Aturan Abaikan)
        const filterRes = await matchFilters(item.message, item.deviceId);
        if (filterRes.matched && filterRes.action === "discard") {
          // Aksi buang: jangan simpan ke DB
          stat.dropped += 1;
          continue;
        }

        stat.stored += 1;

        // Normalisasi log via parser sesuai tipe perangkat / isi pesan
        const normalized = parseLog(
          item.message,
          item.raw,
          item.deviceType,
          item.severity ?? 6
        );

        let finalSeverity =
          normalized.severity !== 6
            ? normalized.severity
            : item.severity ?? normalized.severity;

        // Aksi turunkan severity: ubah jadi 7 (debug)
        if (filterRes.matched && filterRes.action === "lower_severity") {
          finalSeverity = 7;
        }

        if (finalSeverity <= 2) stat.severityCritical = (stat.severityCritical || 0) + 1;
        else if (finalSeverity === 3) stat.severityError = (stat.severityError || 0) + 1;
        else if (finalSeverity === 4) stat.severityWarning = (stat.severityWarning || 0) + 1;
        else if (finalSeverity === 5) stat.severityNotice = (stat.severityNotice || 0) + 1;
        else if (finalSeverity === 6) stat.severityInfo = (stat.severityInfo || 0) + 1;
        else stat.severityDebug = (stat.severityDebug || 0) + 1;

        const receivedAtDate = new Date(item.receivedAt);
        const resolved = resolveEventTime(item.eventTime, receivedAtDate);
        const patternHash = getPatternHash(item.message);
        const isProtected = await isFloodProtected(item.deviceId, patternHash);
        const shouldDedupe = (filterRes.matched && filterRes.action === "merge") || isProtected;

        // Catat frekuensi pola untuk agregasi ringkasan (asinkron / non-blocking)
        recordPatternFrequency(item.deviceId, item.message, finalSeverity).catch(() => {});

        // C. Logika Deduplikasi (Dedupe)
        if (shouldDedupe) {
          const patternKey = `${item.deviceId}:${patternHash}`;

          // C1. Cek apakah sudah ada parent di dalam batch yang sedang berjalan ini
          if (inBatchParents.has(patternKey)) {
            const parentIdx = inBatchParents.get(patternKey)!;
            toInsert[parentIdx].repeatCount += 1;
            toInsert[parentIdx].eventTime = resolved.eventTime;
            continue;
          }

          // C2. Cek apakah ada jendela dedupe aktif di Redis (dari batch sebelumnya dalam 60s)
          const dedupeCheck = await checkAndTrackDedupe(item.deviceId, patternHash);
          if (dedupeCheck.isDuplicate && dedupeCheck.parentLogId) {
            const existing = parentUpdatesMap.get(dedupeCheck.parentLogId);
            if (existing) {
              existing.count += 1;
              existing.lastTime = resolved.eventTime;
            } else {
              parentUpdatesMap.set(dedupeCheck.parentLogId, {
                count: 1,
                lastTime: resolved.eventTime,
              });
            }
            continue;
          }

          // C3. Pesan baru pertama dalam jendela dedupe
          const insertIdx = toInsert.length;
          inBatchParents.set(patternKey, insertIdx);
        }

        toInsert.push({
          deviceId: item.deviceId,
          receivedAt: receivedAtDate,
          eventTime: resolved.eventTime,
          severity: finalSeverity,
          facility: item.facility ?? 1,
          sourceApp: item.sourceApp || normalized.sourceApp || null,
          category: normalized.category || item.category || "other",
          message: item.message,
          raw: item.raw,
          parsed: {
            ...(typeof item.parsed === "object" ? item.parsed : {}),
            ...normalized.parsed,
            ...(resolved.deviceTime ? { device_time: resolved.deviceTime } : {}),
            ...(typeof resolved.clockSkewSeconds === "number"
              ? { clock_skew_seconds: resolved.clockSkewSeconds }
              : {}),
          },
          repeatCount: 1,
          firstEventTime: resolved.eventTime,
          patternHash,
        });
      }

      // 2. Insert baris baru ke log_events
      if (toInsert.length > 0) {
        const values = toInsert.map((t) => ({
          deviceId: t.deviceId,
          receivedAt: t.receivedAt,
          eventTime: t.eventTime,
          severity: t.severity,
          facility: t.facility,
          sourceApp: t.sourceApp,
          category: t.category as any,
          message: t.message,
          raw: t.raw,
          parsed: t.parsed,
          repeatCount: t.repeatCount,
          firstEventTime: t.firstEventTime,
        }));

        let insertedRows: Array<{ id: number }> = [];

        try {
          insertedRows = await db
            .insert(logEvents)
            .values(values)
            .returning({ id: logEvents.id });
        } catch (insertErr: any) {
          if (insertErr?.code === "23503") {
            const activeDevs = await db.select({ id: devices.id }).from(devices);
            const activeDevSet = new Set(activeDevs.map((d) => d.id));
            const validValues = values.filter((v) => activeDevSet.has(v.deviceId));
            if (validValues.length > 0) {
              insertedRows = await db
                .insert(logEvents)
                .values(validValues)
                .returning({ id: logEvents.id });
            }
          } else {
            throw insertErr;
          }
        }

        // Daftarkan inserted row sebagai dedupe parent di Redis secara paralel
        await Promise.all(
          insertedRows.map((row, i) => {
            const item = toInsert[i];
            return item
              ? registerDedupeParent(item.deviceId, item.patternHash, row.id)
              : Promise.resolve();
          })
        );

        // Terbitkan event pembaruan log.baru (di-coalesce per perangkat)
        const deviceLogCounts = new Map<string, { lastId: number; count: number }>();
        insertedRows.forEach((row, i) => {
          const item = toInsert[i];
          if (!item) return;
          const curr = deviceLogCounts.get(item.deviceId) || { lastId: row.id, count: 0 };
          curr.lastId = Math.max(curr.lastId, row.id);
          curr.count += 1;
          deviceLogCounts.set(item.deviceId, curr);
        });

        for (const [devId, stat] of deviceLogCounts.entries()) {
          publishChange({
            tipe: "log.baru",
            perangkat_id: devId,
            data_ringkas: {
              id_log_terakhir: stat.lastId,
              jumlah: stat.count,
            },
          }).catch(() => {});
        }
      }

      // 3. Flush akumulasi penambahan repeat_count ke baris parent lama di database
      if (parentUpdatesMap.size > 0) {
        const updates = Array.from(parentUpdatesMap.entries()).map(([logId, data]) => ({
          logId,
          additionalCount: data.count,
          lastEventTime: data.lastTime,
        }));
        await flushDedupeCountsToDb(updates);
      }

      // 4. Update devices.lastSeenAt secara batch dengan pembatasan 1x per 30 detik
      const uniqueDeviceIds = Array.from(new Set(batchToInsert.map((i) => i.deviceId)));

      const throttleChecks = await Promise.all(
        uniqueDeviceIds.map(async (devId) => {
          const throttleKey = `throttle:lastseen:${devId}`;
          const acquired = await redis.set(throttleKey, "1", "EX", 30, "NX");
          return { devId, acquired: acquired === "OK" };
        })
      );

      const toUpdateDevIds = throttleChecks.filter((t) => t.acquired).map((t) => t.devId);
      if (toUpdateDevIds.length > 0) {
        await db
          .update(devices)
          .set({ lastSeenAt: new Date() })
          .where(sql`${devices.id} IN ${toUpdateDevIds}`);
      }

      // 5. Catat statistik akumulasi log per jam ke tabel device_log_hourly
      if (hourlyStatsMap.size > 0) {
        recordHourlyLogBatch(Array.from(hourlyStatsMap.values()))
          .then(() => {
            for (const devId of uniqueDeviceIds) {
              publishChange({
                tipe: "pengiriman_log.berubah",
                perangkat_id: devId,
              }).catch(() => {});
              publishChange({
                tipe: "statistik.diperbarui",
                perangkat_id: devId,
              }).catch(() => {});
            }
          })
          .catch((err) => console.error("[HourlyLogBatch Error]", err));
      }
    } catch (err) {
      console.error("[Worker Batch Insert Error]", err);
    }
  };

  const scheduleFlush = () => {
    if (!flushTimeout) {
      flushTimeout = setTimeout(async () => {
        flushTimeout = null;
        await flushBatch();
      }, FLUSH_INTERVAL_MS);
    }
  };

  const worker = new Worker<RawLogPayload>(
    INGEST_QUEUE_NAME,
    async (job: Job<RawLogPayload>) => {
      pendingBuffer.push(job.data);

      if (pendingBuffer.length >= BATCH_SIZE) {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        await flushBatch();
      } else {
        scheduleFlush();
      }

      return { status: "queued_for_batch" };
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker Job Failed] id: ${job?.id}`, err);
  });

  return worker;
}
