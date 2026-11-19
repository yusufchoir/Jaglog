import { db } from "../db";
import { devices, deviceStatusHistory, devicePingHourly, deviceLogHourly, logEvents } from "../schema";
import { eq, and, sql, or, gte, lte } from "drizzle-orm";
import {
  RentangOption,
  SkalaOption,
  TimelineResponse,
  StatusSlot,
  PingServerSlot,
  PingRingkasan,
  LogDeliverySlot,
  LogDeliveryRingkasan,
  resolveDateRange,
  resolveConcreteScale,
  generateSlotBoundaries,
  determineSlotStatus,
  formatDurationHuman,
  evaluatePingSlotStatus,
  evaluateLogDeliverySlotStatus,
} from "./timeline_utils";

export * from "./timeline_utils";

/**
 * Hitung riwayat ketersediaan & timeline slot komprehensif
 */
export async function calculateComprehensiveTimeline(
  deviceId: string,
  rentang: RentangOption,
  skalaReq: SkalaOption,
  customDari?: string,
  customSampai?: string
): Promise<TimelineResponse> {
  const now = new Date();
  const { start, end } = resolveDateRange(rentang, customDari, customSampai, now);
  const concreteScale = resolveConcreteScale(rentang, skalaReq, start, end);

  // 1. Ambil data perangkat untuk createdAt, status saat ini, ping, dan log config
  const [device] = await db
    .select({
      id: devices.id,
      createdAt: devices.createdAt,
      status: devices.status,
      isActive: devices.isActive,
      pingEnabled: devices.pingEnabled,
      pingFailureThreshold: devices.pingFailureThreshold,
      offlineAfterMinutes: devices.offlineAfterMinutes,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  if (!device) {
    throw new Error("Perangkat tidak ditemukan.");
  }

  const devCreatedAtMs = device.createdAt ? new Date(device.createdAt).getTime() : 0;

  const sectionStatus = {
    status_utama: "ok" as "ok" | "gagal" | "tanpa_data",
    ping: "ok" as "ok" | "gagal" | "tanpa_data",
    pengiriman_log: "ok" as "ok" | "gagal" | "tanpa_data",
    ringkasan: "ok" as "ok" | "gagal" | "tanpa_data",
  };

  // 2. Ambil seluruh riwayat status yang beririsan dengan interval [start, end]
  let historyRows: any[] = [];
  try {
    historyRows = await db
      .select()
      .from(deviceStatusHistory)
      .where(
        and(
          eq(deviceStatusHistory.deviceId, deviceId),
          sql`${deviceStatusHistory.startedAt} <= ${end.toISOString()}::timestamptz`,
          or(
            sql`${deviceStatusHistory.endedAt} IS NULL`,
            sql`${deviceStatusHistory.endedAt} >= ${start.toISOString()}::timestamptz`
          )
        )
      )
      .orderBy(deviceStatusHistory.startedAt);
    if (historyRows.length === 0) {
      sectionStatus.status_utama = "tanpa_data";
    }
  } catch (err: any) {
    console.warn(`[Timeline API] Query deviceStatusHistory gagal untuk device ${deviceId}:`, err.message);
    sectionStatus.status_utama = "gagal";
  }

  // 3. Generate slot boundaries
  const rawSlots = generateSlotBoundaries(start, end, concreteScale);

  // 3b. Ambil data agregasi per jam untuk Ping dan Log
  let pingHourlyRows: any[] = [];
  try {
    pingHourlyRows = await db
      .select()
      .from(devicePingHourly)
      .where(
        and(
          eq(devicePingHourly.deviceId, deviceId),
          gte(devicePingHourly.hourBucket, new Date(start.getTime() - 3600 * 1000)),
          lte(devicePingHourly.hourBucket, end)
        )
      )
      .orderBy(devicePingHourly.hourBucket);
    if (pingHourlyRows.length === 0) {
      sectionStatus.ping = "tanpa_data";
    }
  } catch (err: any) {
    console.warn(`[Timeline API] Query devicePingHourly gagal untuk device ${deviceId}:`, err.message);
    sectionStatus.ping = "gagal";
  }

  let logHourlyRows: any[] = [];
  try {
    logHourlyRows = await db
      .select()
      .from(deviceLogHourly)
      .where(
        and(
          eq(deviceLogHourly.deviceId, deviceId),
          gte(deviceLogHourly.hourBucket, new Date(start.getTime() - 3600 * 1000)),
          lte(deviceLogHourly.hourBucket, end)
        )
      )
      .orderBy(deviceLogHourly.hourBucket);
  } catch (err: any) {
    console.warn(`[Timeline API] Query deviceLogHourly gagal untuk device ${deviceId}:`, err.message);
    sectionStatus.pengiriman_log = "gagal";
  }

  // Jika skala < 1 jam (15m atau 30m pada rentang <= 24j), hitung jumlah log per slot dari log_events
  const slotLogCountMap = new Map<number, number>();
  if (concreteScale === "15m" || concreteScale === "30m") {
    try {
      const slotStepSeconds = concreteScale === "15m" ? 900 : 1800;
      const slotEvents = await db.execute<{ slot_idx: number; cnt: string }>(sql`
        SELECT
          FLOOR(EXTRACT(EPOCH FROM (event_time - ${start.toISOString()}::timestamptz)) / ${slotStepSeconds})::int AS slot_idx,
          COUNT(*)::text AS cnt
        FROM log_events
        WHERE device_id = ${deviceId}::uuid
          AND event_time >= ${start.toISOString()}::timestamptz
          AND event_time <= ${end.toISOString()}::timestamptz
        GROUP BY slot_idx
      `);
      for (const r of (slotEvents as unknown as Array<{ slot_idx: number; cnt: string }>)) {
        if (r.slot_idx !== null && r.slot_idx !== undefined) {
          slotLogCountMap.set(r.slot_idx, parseInt(r.cnt, 10) || 0);
        }
      }
    } catch (err: any) {
      console.warn(`[Timeline API] Query slot log_events gagal untuk device ${deviceId}:`, err.message);
      if (sectionStatus.pengiriman_log === "ok") {
        sectionStatus.pengiriman_log = "gagal";
      }
    }
  }

  if (logHourlyRows.length === 0 && slotLogCountMap.size === 0 && sectionStatus.pengiriman_log === "ok") {
    sectionStatus.pengiriman_log = "tanpa_data";
  }

  // 4. Hitung durasi per status per slot lewat overlap
  let totalOnlineSec = 0;
  let totalLogStoppedSec = 0;
  let totalOfflineSec = 0;
  let totalTanpaDataSec = 0;
  let totalDowntimeSec = 0;
  let totalGangguanCount = 0;
  let maxGangguanDurationSec = 0;

  const earliestHistoryMs =
    historyRows.length > 0 ? new Date(historyRows[0].startedAt).getTime() : 0;

  const resultSlots: StatusSlot[] = rawSlots.map((slot) => {
    const sMs = slot.start.getTime();
    const eMs = slot.end.getTime();
    const slotDurationSec = Math.max(1, Math.round((eMs - sMs) / 1000));

    let secOnline = 0;
    let secLogStopped = 0;
    let secOffline = 0;
    const gangguanList: StatusSlot["gangguan"] = [];

    for (const h of historyRows) {
      const hStartMs = new Date(h.startedAt).getTime();
      const hEndMs = h.endedAt ? new Date(h.endedAt).getTime() : now.getTime();

      const overlapStartMs = Math.max(sMs, hStartMs);
      const overlapEndMs = Math.min(eMs, hEndMs);

      if (overlapEndMs > overlapStartMs) {
        const overlapSec = (overlapEndMs - overlapStartMs) / 1000;
        const normStatus = h.status === "rto" ? "offline" : h.status;

        if (normStatus === "online") {
          secOnline += overlapSec;
        } else if (normStatus === "log_stopped") {
          secLogStopped += overlapSec;
          gangguanList.push({
            mulai: new Date(overlapStartMs).toISOString(),
            selesai: new Date(overlapEndMs).toISOString(),
            durasi_detik: Math.round(overlapSec),
            status: "log_stopped",
          });
        } else if (normStatus === "offline") {
          secOffline += overlapSec;
          gangguanList.push({
            mulai: new Date(overlapStartMs).toISOString(),
            selesai: new Date(overlapEndMs).toISOString(),
            durasi_detik: Math.round(overlapSec),
            status: "offline",
          });
        }
      }
    }

    // Waktu sebelum perangkat dibuat atau sebelum riwayat pertama = tanpa data
    let secTanpaData = 0;
    const activeRecordedSec = secOnline + secLogStopped + secOffline;

    if (devCreatedAtMs > 0 && eMs <= devCreatedAtMs) {
      secTanpaData = slotDurationSec;
    } else if (earliestHistoryMs > 0 && eMs <= earliestHistoryMs) {
      secTanpaData = slotDurationSec;
    } else {
      secTanpaData = Math.max(0, slotDurationSec - activeRecordedSec);
    }

    // Tentukan status akhir slot
    const slotStatus = determineSlotStatus({
      slotDurationSeconds: slotDurationSec,
      detikOnline: secOnline,
      detikLogBerhenti: secLogStopped,
      detikOffline: secOffline,
      detikTanpaData: secTanpaData,
    });

    const recordedSlotSec = secOnline + secLogStopped + secOffline;
    let slotUptimePct: number | null = null;
    if (recordedSlotSec > 0) {
      slotUptimePct = Math.min(
        100,
        Math.max(0, Math.round((secOnline / recordedSlotSec) * 1000) / 10)
      );
    }

    totalOnlineSec += secOnline;
    totalLogStoppedSec += secLogStopped;
    totalOfflineSec += secOffline;
    totalTanpaDataSec += secTanpaData;
    totalDowntimeSec += secOffline + secLogStopped;

    return {
      mulai: slot.start.toISOString(),
      selesai: slot.end.toISOString(),
      status: slotStatus,
      uptime_persen: slotUptimePct,
      detik_online: Math.round(secOnline),
      detik_log_berhenti: Math.round(secLogStopped),
      detik_offline: Math.round(secOffline),
      detik_tanpa_data: Math.round(secTanpaData),
      jumlah_gangguan: gangguanList.length,
      sebagian: slot.sebagian,
      gangguan: gangguanList,
    };
  });

  // Hitung total gangguan dan gangguan terlama secara kontigu sepanjang rentang
  for (const h of historyRows) {
    if (h.status === "offline" || h.status === "rto" || h.status === "log_stopped") {
      const hStartMs = Math.max(start.getTime(), new Date(h.startedAt).getTime());
      const hEndMs = Math.min(end.getTime(), h.endedAt ? new Date(h.endedAt).getTime() : now.getTime());
      if (hEndMs > hStartMs) {
        totalGangguanCount++;
        const durSec = Math.round((hEndMs - hStartMs) / 1000);
        if (durSec > maxGangguanDurationSec) {
          maxGangguanDurationSec = durSec;
        }
      }
    }
  }

  // 5. Hitung ringkasan
  const totalRecordedValidSec = totalOnlineSec + totalLogStoppedSec + totalOfflineSec;
  const totalRangeSec = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
  let ringkasanUptimePct: number | null = null;

  if (totalRecordedValidSec > 0) {
    ringkasanUptimePct = Math.min(
      100,
      Math.max(0, Math.round((totalOnlineSec / totalRecordedValidSec) * 1000) / 10)
    );
  }

  const cakupanDataPct = Math.min(
    100,
    Math.max(0, Math.round((totalRecordedValidSec / totalRangeSec) * 1000) / 10)
  );

  let keteranganCakupan: string | undefined = undefined;
  if (cakupanDataPct < 100 && totalRecordedValidSec > 0) {
    const dataHuman = formatDurationHuman(totalRecordedValidSec);
    const rangeHuman = formatDurationHuman(totalRangeSec);
    keteranganCakupan = `Berdasarkan ${dataHuman} data dari ${rangeHuman}`;
  } else if (totalRecordedValidSec === 0) {
    keteranganCakupan = "Belum ada rekaman riwayat status pada rentang ini";
  }

  // 6. Bentuk baris slot Ping Server
  const pingSlots: PingServerSlot[] = rawSlots.map((slot) => {
    const sMs = slot.start.getTime();
    const eMs = slot.end.getTime();
    const slotDurationSec = Math.max(1, Math.round((eMs - sMs) / 1000));

    let checkTotal = 0;
    let checkFail = 0;
    let maxRtoSec = 0;
    let totalLatencyWeighted = 0;
    let totalLatencyCount = 0;

    for (const ph of pingHourlyRows) {
      const phStart = new Date(ph.hourBucket).getTime();
      const phEnd = phStart + 3600 * 1000;
      const overlapStart = Math.max(sMs, phStart);
      const overlapEnd = Math.min(eMs, phEnd);

      if (overlapEnd > overlapStart) {
        const fraction = (overlapEnd - overlapStart) / (3600 * 1000);
        const checks = Math.round(ph.checkCount * fraction);
        const fails = Math.round(ph.failCount * fraction);
        checkTotal += checks;
        checkFail += fails;
        if (ph.maxConsecutiveRtoSeconds > maxRtoSec) {
          maxRtoSec = ph.maxConsecutiveRtoSeconds;
        }
        if (ph.avgLatencyMs !== null && checks > fails) {
          totalLatencyWeighted += ph.avgLatencyMs * (checks - fails);
          totalLatencyCount += (checks - fails);
        }
      }
    }

    // Ambil kejadian Down individual dari historyRows (rto)
    const downEventsInSlot: Array<{ mulai: string; selesai: string; durasi_detik: number }> = [];
    for (const h of historyRows) {
      if (h.status === "rto") {
        const hStartMs = new Date(h.startedAt).getTime();
        const hEndMs = h.endedAt ? new Date(h.endedAt).getTime() : now.getTime();
        const overlapStartMs = Math.max(sMs, hStartMs);
        const overlapEndMs = Math.min(eMs, hEndMs);
        if (overlapEndMs > overlapStartMs) {
          const durSec = Math.round((overlapEndMs - overlapStartMs) / 1000);
          downEventsInSlot.push({
            mulai: new Date(overlapStartMs).toISOString(),
            selesai: new Date(overlapEndMs).toISOString(),
            durasi_detik: durSec,
          });
          if (durSec > maxRtoSec) {
            maxRtoSec = durSec;
          }
          if (checkTotal === 0 && device.pingEnabled) {
            checkTotal = Math.max(1, Math.round(slotDurationSec / 30));
            checkFail = checkTotal;
          } else if (checkFail === 0) {
            checkFail = Math.max(1, Math.round(durSec / 30));
            checkTotal = Math.max(checkTotal, checkFail);
          }
        }
      }
    }

    const avgLatency = totalLatencyCount > 0
      ? Math.round(totalLatencyWeighted / totalLatencyCount)
      : null;

    return evaluatePingSlotStatus({
      slotStart: slot.start,
      slotEnd: slot.end,
      deviceCreatedAt: device.createdAt ? new Date(device.createdAt) : null,
      pingEnabled: Boolean(device.pingEnabled),
      isDeviceActive: Boolean(device.isActive),
      checkCount: checkTotal,
      failCount: checkFail,
      maxConsecutiveRtoSeconds: maxRtoSec,
      avgLatencyMs: avgLatency,
      pingFailureThreshold: device.pingFailureThreshold || 3,
      slotDurationSeconds: slotDurationSec,
      now,
      sebagianSlot: slot.sebagian,
      downEvents: downEventsInSlot,
    });
  });

  // 7. Bentuk baris slot Pengiriman Log
  const hasDeviceSentLogsEver = Boolean(device.lastSeenAt);
  const logSlots: LogDeliverySlot[] = rawSlots.map((slot, idx) => {
    const sMs = slot.start.getTime();
    const eMs = slot.end.getTime();
    const slotDurationSec = Math.max(1, Math.round((eMs - sMs) / 1000));

    let logCount = 0;
    if (concreteScale === "15m" || concreteScale === "30m") {
      logCount = slotLogCountMap.get(idx) || 0;
      // Tambahkan porsi dropped log bila ada
      for (const lh of logHourlyRows) {
        const lhStart = new Date(lh.hourBucket).getTime();
        const lhEnd = lhStart + 3600 * 1000;
        const overlapStart = Math.max(sMs, lhStart);
        const overlapEnd = Math.min(eMs, lhEnd);
        if (overlapEnd > overlapStart && lh.droppedCount > 0) {
          const frac = (overlapEnd - overlapStart) / (3600 * 1000);
          logCount += Math.round(lh.droppedCount * frac);
        }
      }
    } else {
      for (const lh of logHourlyRows) {
        const lhTime = new Date(lh.hourBucket).getTime();
        if (lhTime >= sMs && lhTime < eMs) {
          logCount += lh.receivedCount;
        }
      }
    }

    // Ambil periode tidak aktif (log_stopped atau offline)
    const inactivePeriodsInSlot: Array<{ mulai: string; selesai: string; durasi_detik: number }> = [];
    let maxGapSecInSlot = 0;

    for (const h of historyRows) {
      if (h.status === "log_stopped" || h.status === "offline") {
        const hStartMs = new Date(h.startedAt).getTime();
        const hEndMs = h.endedAt ? new Date(h.endedAt).getTime() : now.getTime();
        const overlapStartMs = Math.max(sMs, hStartMs);
        const overlapEndMs = Math.min(eMs, hEndMs);
        if (overlapEndMs > overlapStartMs) {
          const durSec = Math.round((overlapEndMs - overlapStartMs) / 1000);
          inactivePeriodsInSlot.push({
            mulai: new Date(overlapStartMs).toISOString(),
            selesai: new Date(overlapEndMs).toISOString(),
            durasi_detik: durSec,
          });
          if (durSec > maxGapSecInSlot) {
            maxGapSecInSlot = durSec;
          }
        }
      }
    }

    if (slotDurationSec >= 3600) {
      for (const lh of logHourlyRows) {
        const lhTime = new Date(lh.hourBucket).getTime();
        if (lhTime >= sMs && lhTime < eMs) {
          if (lh.maxGapSeconds > maxGapSecInSlot) {
            maxGapSecInSlot = lh.maxGapSeconds;
          }
        }
      }
    }

    return evaluateLogDeliverySlotStatus({
      slotStart: slot.start,
      slotEnd: slot.end,
      deviceCreatedAt: device.createdAt ? new Date(device.createdAt) : null,
      isDeviceActive: Boolean(device.isActive),
      hasDeviceSentLogsEver,
      receivedCount: logCount,
      maxGapSeconds: maxGapSecInSlot,
      offlineAfterMinutes: device.offlineAfterMinutes || 10,
      slotDurationSeconds: slotDurationSec,
      now,
      sebagianSlot: slot.sebagian,
      inactivePeriods: inactivePeriodsInSlot,
    });
  });

  // 8. Hitung Ringkasan Ping
  let totalPingChecks = 0;
  let totalPingSuccess = 0;
  let downOccurrencesCount = 0;
  let maxDownSec = 0;

  for (const s of pingSlots) {
    if (s.status !== "unknown") {
      totalPingChecks += s.cek_total;
      totalPingSuccess += (s.cek_total - s.cek_gagal);
    }
  }

  for (const h of historyRows) {
    if (h.status === "rto") {
      const hStartMs = Math.max(start.getTime(), new Date(h.startedAt).getTime());
      const hEndMs = Math.min(end.getTime(), h.endedAt ? new Date(h.endedAt).getTime() : now.getTime());
      if (hEndMs > hStartMs) {
        downOccurrencesCount++;
        const dur = Math.round((hEndMs - hStartMs) / 1000);
        if (dur > maxDownSec) maxDownSec = dur;
      }
    }
  }

  const persenUp = !device.pingEnabled
    ? null
    : totalPingChecks > 0
    ? Math.min(100, Math.max(0, Math.round((totalPingSuccess / totalPingChecks) * 1000) / 10))
    : null;

  const pingRingkasan: PingRingkasan = {
    persen_up: persenUp,
    jumlah_down: downOccurrencesCount,
    down_terlama_detik: maxDownSec,
  };

  // 9. Hitung Ringkasan Pengiriman Log
  let totalLogSlotsValid = 0;
  let totalLogSlotsSending = 0;
  let inactivePeriodsCount = 0;
  let maxInactiveSec = 0;

  for (const s of logSlots) {
    if (s.status !== "unknown") {
      totalLogSlotsValid++;
      if (s.status === "mengirim") {
        totalLogSlotsSending++;
      }
    }
  }

  for (const h of historyRows) {
    if (h.status === "log_stopped" || h.status === "offline") {
      const hStartMs = Math.max(start.getTime(), new Date(h.startedAt).getTime());
      const hEndMs = Math.min(end.getTime(), h.endedAt ? new Date(h.endedAt).getTime() : now.getTime());
      if (hEndMs > hStartMs) {
        inactivePeriodsCount++;
        const dur = Math.round((hEndMs - hStartMs) / 1000);
        if (dur > maxInactiveSec) maxInactiveSec = dur;
      }
    }
  }

  const persenMengirim = totalLogSlotsValid > 0
    ? Math.min(100, Math.max(0, Math.round((totalLogSlotsSending / totalLogSlotsValid) * 1000) / 10))
    : null;

  const logRingkasan: LogDeliveryRingkasan = {
    persen_mengirim: persenMengirim,
    jumlah_periode_tidak_mengirim: inactivePeriodsCount,
    tidak_mengirim_terlama_detik: maxInactiveSec,
    log_terakhir_pada: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null,
  };

  return {
    rentang,
    skala: skalaReq,
    skala_terpilih: concreteScale,
    slot_terpilih_skala: concreteScale,
    dari: start.toISOString(),
    sampai: end.toISOString(),
    ringkasan: {
      uptime_persen: ringkasanUptimePct,
      total_downtime_detik: Math.round(totalDowntimeSec),
      jumlah_gangguan: totalGangguanCount,
      gangguan_terlama_detik: Math.round(maxGangguanDurationSec),
      cakupan_data_persen: cakupanDataPct,
      keterangan_cakupan: keteranganCakupan,
      total_durasi_tercakup_detik: Math.round(totalRecordedValidSec),
      total_durasi_rentang_detik: totalRangeSec,
    },
    slots: resultSlots,
    ping: {
      aktif: Boolean(device.pingEnabled),
      slot: pingSlots,
      ringkasan: pingRingkasan,
    },
    pengiriman_log: {
      slot: logSlots,
      ringkasan: logRingkasan,
    },
    section_status: sectionStatus,
  };
}
