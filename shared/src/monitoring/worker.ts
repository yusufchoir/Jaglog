import { db } from "../db";
import { devices, deviceStatusHistory, incidents } from "../schema";
import { eq, and, sql, or, desc } from "drizzle-orm";
import { redis } from "../redis";
import { pingDevicesWithDetailsInBatches, PingResult } from "./ping";
import { calculateDeviceStatus, isDeviceOnline, DeviceMonitoringStatus } from "../devices";
import { dispatchDeviceStatusNotification, getSuspectedCause } from "../notifications";
import { recordHourlyPingResults } from "./hourly_stats";
import { publishChange } from "../events/publisher";

interface DevicePingState {
  failCount: number;
  successCount: number;
  isRto: boolean;
  rtoStartedAt?: string | null;
  lastReminderTime?: number;
  hasSent30mReminder?: boolean;
  flips?: number[];
}

/**
 * Run single cycle of device status evaluation
 */
export async function runDeviceStatusCycle(): Promise<{
  processed: number;
  changed: number;
  pinged: number;
}> {
  // 1. Ambil semua perangkat yang aktif
  const activeDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.isActive, true));

  if (activeDevices.length === 0) {
    return { processed: 0, changed: 0, pinged: 0 };
  }

  // 2. Filter perangkat yang memerlukan ping (pingEnabled = true dan ipAddress ada)
  const devicesToPing = activeDevices.filter(
    (d) => d.pingEnabled && Boolean(d.ipAddress)
  );

  const pingResults = await pingDevicesWithDetailsInBatches(
    devicesToPing,
    (d) => d.ipAddress,
    20
  );

  let changedCount = 0;
  const now = new Date();
  const nowMs = now.getTime();
  const pingResultsToRecord: Array<{
    deviceId: string;
    timestamp: Date;
    isAlive: boolean;
    latencyMs: number | null;
    isRto: boolean;
    rtoSeconds?: number;
  }> = [];

  for (const dev of activeDevices) {
    let pingResult: PingResult | null = null;
    let pingTime: Date | null = null;

    if (dev.pingEnabled && dev.ipAddress) {
      pingResult = pingResults.get(dev) ?? { isAlive: false, latencyMs: null, method: null };
      pingTime = now;
    }

    const pingOk = pingResult ? pingResult.isAlive : null;
    const pingRtt = pingResult ? pingResult.latencyMs : null;
    const isLogActive = isDeviceOnline(dev.lastSeenAt, dev.offlineAfterMinutes);

    // 3. Kelola State RTO berturut-turut via Redis jika ping diaktifkan
    let isRtoState = false;
    let rtoEventTriggered: "ping_rto" | "ping_recovered" | null = null;
    let rtoDurationText = "";

    if (dev.pingEnabled && dev.ipAddress) {
      const stateKey = `dev_ping_state:${dev.id}`;
      let pingState: DevicePingState = {
        failCount: 0,
        successCount: 0,
        isRto: false,
        rtoStartedAt: null,
        lastReminderTime: 0,
        hasSent30mReminder: false,
        flips: [],
      };

      const rawState = await redis.get(stateKey);
      if (rawState) {
        try {
          pingState = { ...pingState, ...JSON.parse(rawState) };
        } catch {
          // Abaikan parse error
        }
      }

      const failureThreshold = dev.pingFailureThreshold || 3;

      if (!pingOk) {
        // Ping Gagal
        pingState.failCount = (pingState.failCount || 0) + 1;
        pingState.successCount = 0;

        if (!pingState.isRto && pingState.failCount >= failureThreshold) {
          // Ambang terpenuhi: Memicu transisi status ke RTO!
          pingState.isRto = true;
          pingState.rtoStartedAt = now.toISOString();
          pingState.hasSent30mReminder = false;
          pingState.lastReminderTime = nowMs;
          rtoEventTriggered = "ping_rto";

          // Catat flip dalam sliding window 30 menit
          pingState.flips = (pingState.flips || []).filter((t) => nowMs - t <= 1800000);
          pingState.flips.push(nowMs);
        } else if (pingState.isRto && pingState.rtoStartedAt) {
          // Masih dalam kondisi RTO -> Cek pengingat anti-spam (30 menit, lalu tiap 2 jam)
          const startMs = new Date(pingState.rtoStartedAt).getTime();
          const elapsedMinutes = Math.floor((nowMs - startMs) / 60000);
          const timeSinceLastReminder = nowMs - (pingState.lastReminderTime || startMs);

          let sendReminder = false;
          let reminderMsg = "";

          if (elapsedMinutes >= 30 && !pingState.hasSent30mReminder) {
            sendReminder = true;
            reminderMsg = `Pengingat: Masih RTO selama ${elapsedMinutes} menit`;
            pingState.hasSent30mReminder = true;
            pingState.lastReminderTime = nowMs;
          } else if (elapsedMinutes > 30 && timeSinceLastReminder >= 2 * 3600 * 1000) {
            sendReminder = true;
            const hours = (elapsedMinutes / 60).toFixed(1);
            reminderMsg = `Pengingat berkala: Masih RTO selama ${hours} jam`;
            pingState.lastReminderTime = nowMs;
          }

          if (sendReminder && dev.notifyOnRto) {
            const holdKey = `notif:flapping_held:${dev.id}`;
            const isHeld = await redis.get(holdKey);
            if (!isHeld) {
              await dispatchDeviceStatusNotification({
                device: dev,
                eventType: "ping_rto",
                durationText: reminderMsg,
                isPingOk: false,
                isLogActive,
              }).catch((e) => console.error("[Reminder Error]", e));
            }
          }
        }
      } else {
        // Ping Berhasil
        pingState.successCount = (pingState.successCount || 0) + 1;
        pingState.failCount = 0;

        if (pingState.isRto && pingState.successCount >= 2) {
          // Pulih setelah 2 kali sukses berturut-turut
          pingState.isRto = false;
          const startMs = pingState.rtoStartedAt ? new Date(pingState.rtoStartedAt).getTime() : nowMs;
          const durationMinutes = Math.max(1, Math.round((nowMs - startMs) / 60000));
          rtoDurationText = `RTO berlangsung selama ${durationMinutes} menit`;
          rtoEventTriggered = "ping_recovered";

          pingState.rtoStartedAt = null;
          pingState.hasSent30mReminder = false;
          pingState.lastReminderTime = 0;

          // Catat flip dalam sliding window 30 menit
          pingState.flips = (pingState.flips || []).filter((t) => nowMs - t <= 1800000);
          pingState.flips.push(nowMs);
        }
      }

      // Evaluasi deteksi flapping (perubahan status > 4 kali dalam 30 menit)
      if (rtoEventTriggered) {
        if ((pingState.flips || []).length > 4) {
          const holdKey = `notif:flapping_held:${dev.id}`;
          const isHeld = await redis.get(holdKey);
          if (!isHeld) {
            await redis.set(holdKey, "1", "EX", 1800);
            await dispatchDeviceStatusNotification({
              device: dev,
              eventType: "flapping_detected",
              durationText: "Terjadi perubahan status bolak-balik lebih dari 4 kali dalam 30 menit. Notifikasi ditahan selama 30 menit.",
              isPingOk: pingOk ?? false,
              isLogActive,
            }).catch((e) => console.error("[Flapping Notif Error]", e));
          }
          // Tahan event rto/recovered individual saat flapping
          rtoEventTriggered = null;
        } else if (dev.notifyOnRto) {
          await dispatchDeviceStatusNotification({
            device: dev,
            eventType: rtoEventTriggered,
            durationText: rtoDurationText || undefined,
            isPingOk: pingOk ?? false,
            isLogActive,
          }).catch((e) => console.error("[RTO Notif Error]", e));
        }
      }

      isRtoState = pingState.isRto;
      await redis.set(stateKey, JSON.stringify(pingState), "EX", 86400 * 7);
    }

    // 4. Update status ping dan RTT ke database
    if (pingTime !== null) {
      await db
        .update(devices)
        .set({
          lastPingAt: pingTime,
          lastPingOk: pingOk,
          lastPingRtt: pingRtt,
        })
        .where(eq(devices.id, dev.id));

      publishChange({
        tipe: "perangkat.ping",
        perangkat_id: dev.id,
        data_ringkas: {
          ping_ok: pingOk ?? false,
          ping_rtt: pingRtt,
        },
      }).catch(() => {});

      if (pingResult) {
        pingResultsToRecord.push({
          deviceId: dev.id,
          timestamp: pingTime,
          isAlive: pingResult.isAlive,
          latencyMs: pingResult.latencyMs,
          isRto: isRtoState,
          rtoSeconds: isRtoState ? 30 : 0,
        });
      }
    }

    // 5. Hitung status komitmen
    let calculatedStatus: DeviceMonitoringStatus;
    if (dev.pingEnabled && isRtoState) {
      calculatedStatus = "rto";
    } else {
      calculatedStatus = calculateDeviceStatus({
        lastSeenAt: dev.lastSeenAt,
        pingEnabled: dev.pingEnabled,
        lastPingOk: pingOk,
        offlineAfterMinutes: dev.offlineAfterMinutes,
      });
    }

    const currentCommittedStatus = (dev.status || "unknown") as DeviceMonitoringStatus;

    // 6. Logika Debounce Perubahan Status (2 siklus berturut-turut)
    const candidateKey = `dev_status_candidate:${dev.id}`;

    if (calculatedStatus === currentCommittedStatus) {
      await redis.del(candidateKey);
      continue;
    }

    const candidateData = await redis.get(candidateKey);
    let candidateCount = 1;

    if (candidateData) {
      try {
        const parsed = JSON.parse(candidateData);
        if (parsed.status === calculatedStatus) {
          candidateCount = (parsed.count || 1) + 1;
        }
      } catch {
        // Abaikan parse error
      }
    }

    if (candidateCount < 2) {
      await redis.set(
        candidateKey,
        JSON.stringify({ status: calculatedStatus, count: candidateCount }),
        "EX",
        120
      );
      continue;
    }

    // Debounce terpenuhi! Lakukan transisi status resmi
    await redis.del(candidateKey);
    changedCount++;

    // A. Tutup riwayat aktif sebelumnya
    await db
      .update(deviceStatusHistory)
      .set({ endedAt: now })
      .where(
        and(
          eq(deviceStatusHistory.deviceId, dev.id),
          sql`${deviceStatusHistory.endedAt} IS NULL`
        )
      );

    // B. Tambahkan baris riwayat status baru
    await db.insert(deviceStatusHistory).values({
      deviceId: dev.id,
      status: calculatedStatus,
      startedAt: now,
      endedAt: null,
    });

    // C. Update status di tabel devices
    await db
      .update(devices)
      .set({
        status: calculatedStatus,
        statusChangedAt: now,
      })
      .where(eq(devices.id, dev.id));

    publishChange({
      tipe: "perangkat.status",
      perangkat_id: dev.id,
      data_ringkas: {
        status_perangkat: calculatedStatus,
        ping_ok: pingOk ?? false,
        ping_rtt: pingRtt,
      },
    }).catch(() => {});

    // D. Pengelolaan Insiden: SATU insiden terbuka per perangkat
    const suspectedCause = getSuspectedCause({
      isPingOk: pingOk ?? false,
      isLogActive,
    });

    if (calculatedStatus === "rto" || calculatedStatus === "log_stopped" || calculatedStatus === "offline") {
      let incidentTitle = `Perangkat "${dev.name}" Mengalami Ping RTO (${suspectedCause})`;
      if (calculatedStatus === "log_stopped") {
        incidentTitle = `Perangkat "${dev.name}" Berhenti Mengirim Log (${suspectedCause})`;
      } else if (calculatedStatus === "offline") {
        incidentTitle = `Perangkat "${dev.name}" Offline (${suspectedCause})`;
      }

      const existingIncident = await db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.deviceId, dev.id),
            eq(incidents.status, "open")
          )
        )
        .limit(1);

      const incidentRuleKey = calculatedStatus === "rto" ? "ping_rto" : "device_silent";

      if (existingIncident.length > 0) {
        await db
          .update(incidents)
          .set({
            title: incidentTitle,
            lastSeen: now,
            count: sql`${incidents.count} + 1`,
            severity: calculatedStatus === "rto" || calculatedStatus === "offline" ? "high" : "medium",
          })
          .where(eq(incidents.id, existingIncident[0].id));
      } else {
        await db.insert(incidents).values({
          deviceId: dev.id,
          ruleKey: incidentRuleKey,
          severity: calculatedStatus === "rto" || calculatedStatus === "offline" ? "high" : "medium",
          title: incidentTitle,
          firstSeen: now,
          lastSeen: now,
          count: 1,
          status: "open",
          mainEntity: dev.name,
          evidence: [
            {
              event: "device_status_change",
              status: calculatedStatus,
              previousStatus: currentCommittedStatus,
              offlineAfterMinutes: dev.offlineAfterMinutes,
              lastSeenAt: dev.lastSeenAt,
              pingEnabled: dev.pingEnabled,
              lastPingOk: pingOk,
              lastPingRtt: pingRtt,
              suspectedCause,
              timestamp: now.toISOString(),
            },
          ],
        });

        publishChange({
          tipe: "insiden.berubah",
          perangkat_id: dev.id,
          data_ringkas: { status: "open" },
        }).catch(() => {});
      }

      // Jika offline biasa (bukan RTO), dispatch offline notification
      if (calculatedStatus === "offline" && !dev.pingEnabled) {
        await dispatchDeviceStatusNotification({
          device: dev,
          eventType: "device_offline",
          durationText: `Terakhir log terlihat ${dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "Belum pernah"}`,
          isPingOk: false,
          isLogActive: false,
        }).catch((e) => console.error("[Offline Notif Error]", e));
      }
    } else if (calculatedStatus === "online") {
      // Kembali online: Tutup insiden yang masih terbuka untuk perangkat ini
      await db
        .update(incidents)
        .set({
          status: "closed",
          lastSeen: now,
        })
        .where(
          and(
            eq(incidents.deviceId, dev.id),
            eq(incidents.status, "open")
          )
        );

      publishChange({
        tipe: "insiden.berubah",
        perangkat_id: dev.id,
        data_ringkas: { status: "closed" },
      }).catch(() => {});

      if ((currentCommittedStatus === "offline" || currentCommittedStatus === "log_stopped") && !dev.pingEnabled) {
        await dispatchDeviceStatusNotification({
          device: dev,
          eventType: "device_recovered",
          durationText: "Perangkat telah kembali normal.",
          isPingOk: true,
          isLogActive: true,
        }).catch((e) => console.error("[Recovered Notif Error]", e));
      }
    }
  }

  // 7. Simpan statistik ping per jam ke device_ping_hourly
  if (pingResultsToRecord.length > 0) {
    await recordHourlyPingResults(pingResultsToRecord)
      .then(() => {
        for (const p of pingResultsToRecord) {
          publishChange({
            tipe: "statistik.diperbarui",
            perangkat_id: p.deviceId,
          }).catch(() => {});
        }
      })
      .catch((e) =>
        console.error("[HourlyPingStats Error in worker]", e)
      );
  }

  return {
    processed: activeDevices.length,
    changed: changedCount,
    pinged: devicesToPing.length,
  };
}

/**
 * Hitung persentase uptime perangkat (24 Jam & 7 Hari)
 */
export async function calculateDeviceUptime(
  deviceId: string
): Promise<{ uptime24h: number; uptime7d: number }> {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Ambil riwayat status yang relevan dalam 7 hari
  const history = await db
    .select()
    .from(deviceStatusHistory)
    .where(
      and(
        eq(deviceStatusHistory.deviceId, deviceId),
        sql`(${deviceStatusHistory.startedAt} >= ${past7d.toISOString()}::timestamptz OR ${deviceStatusHistory.endedAt} IS NULL OR ${deviceStatusHistory.endedAt} >= ${past7d.toISOString()}::timestamptz)`
      )
    )
    .orderBy(desc(deviceStatusHistory.startedAt));

  function computeUptimeForPeriod(startCutoff: Date): number {
    let onlineMs = 0;
    let problematicMs = 0;

    for (const h of history) {
      const segStart = Math.max(new Date(h.startedAt).getTime(), startCutoff.getTime());
      const segEnd = h.endedAt ? Math.min(new Date(h.endedAt).getTime(), now.getTime()) : now.getTime();

      if (segEnd > segStart) {
        const dur = segEnd - segStart;
        if (h.status === "online") {
          onlineMs += dur;
        } else if (h.status === "offline" || h.status === "rto" || h.status === "log_stopped") {
          problematicMs += dur;
        }
      }
    }

    const validRecordedMs = onlineMs + problematicMs;
    if (validRecordedMs <= 0) {
      return 100;
    }

    const pct = (onlineMs / validRecordedMs) * 100;
    return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
  }

  // Jika belum ada riwayat sama sekali, cek status saat ini
  if (history.length === 0) {
    const [dev] = await db
      .select({ status: devices.status })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    const isOffline = dev?.status === "offline" || dev?.status === "rto";
    return {
      uptime24h: isOffline ? 0 : 100,
      uptime7d: isOffline ? 0 : 100,
    };
  }

  return {
    uptime24h: computeUptimeForPeriod(past24h),
    uptime7d: computeUptimeForPeriod(past7d),
  };
}

/**
 * Mengambil slot timeline status 7 hari (42 blok = tiap 4 jam selama 7 hari)
 */
export async function getDeviceStatusTimeline(
  deviceId: string
): Promise<Array<{ start: string; end: string; time: string; status: DeviceMonitoringStatus }>> {
  const now = new Date();
  const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const history = await db
    .select()
    .from(deviceStatusHistory)
    .where(eq(deviceStatusHistory.deviceId, deviceId))
    .orderBy(deviceStatusHistory.startedAt);

  const [dev] = await db
    .select({ status: devices.status, createdAt: devices.createdAt })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  const fallbackStatus = (dev?.status || "unknown") as DeviceMonitoringStatus;
  const devCreatedAtMs = dev?.createdAt ? new Date(dev.createdAt).getTime() : 0;
  const earliestRecordedHistoryMs = history.length > 0 ? new Date(history[0].startedAt).getTime() : 0;

  // Bagi 7 hari menjadi 42 slot (masing-masing 4 jam)
  const slotCount = 42;
  const slotDurationMs = (7 * 24 * 60 * 60 * 1000) / slotCount;
  const timeline: Array<{ start: string; end: string; time: string; status: DeviceMonitoringStatus }> = [];

  for (let i = 0; i < slotCount; i++) {
    const slotStartMs = past7d.getTime() + i * slotDurationMs;
    const slotEndMs = slotStartMs + slotDurationMs;
    const slotStartDate = new Date(slotStartMs);
    const slotEndDate = new Date(slotEndMs);

    // Jika slot waktu berakhir sebelum perangkat didaftarkan -> Belum ada data
    if (devCreatedAtMs > 0 && slotEndMs <= devCreatedAtMs) {
      timeline.push({
        start: slotStartDate.toISOString(),
        end: slotEndDate.toISOString(),
        time: slotStartDate.toISOString(),
        status: "unknown",
      });
      continue;
    }

    // Cari riwayat yang bersinggungan (overlap) dengan slot ini
    const overlaps = history.filter((h) => {
      const s = new Date(h.startedAt).getTime();
      const e = h.endedAt ? new Date(h.endedAt).getTime() : now.getTime();
      return s < slotEndMs && e > slotStartMs;
    });

    let slotStatus: DeviceMonitoringStatus = fallbackStatus;

    if (overlaps.length > 0) {
      // Prioritas status sesuai spesifikasi:
      // Merah: jika ada periode offline
      // Kuning: jika ada periode log berhenti
      // Hijau: jika online
      if (overlaps.some((h) => h.status === "rto")) {
        slotStatus = "rto";
      } else if (overlaps.some((h) => h.status === "offline")) {
        slotStatus = "offline";
      } else if (overlaps.some((h) => h.status === "log_stopped")) {
        slotStatus = "log_stopped";
      } else if (overlaps.some((h) => h.status === "online")) {
        slotStatus = "online";
      } else {
        slotStatus = "unknown";
      }
    } else {
      // Belum ada riwayat transisi tercatat pada rentang ini
      if (history.length > 0 && slotEndMs <= earliestRecordedHistoryMs) {
        slotStatus = "unknown";
      } else if (devCreatedAtMs > 0 && slotStartMs < devCreatedAtMs) {
        slotStatus = "unknown";
      } else {
        slotStatus = fallbackStatus;
      }
    }

    timeline.push({
      start: slotStartDate.toISOString(),
      end: slotEndDate.toISOString(),
      time: slotStartDate.toISOString(),
      status: slotStatus,
    });
  }

  return timeline;
}

let statusWorkerInterval: NodeJS.Timeout | null = null;

/**
 * Start background device status evaluation worker
 */
export function startDeviceStatusWorker(intervalSeconds = 30): void {
  if (statusWorkerInterval) {
    clearInterval(statusWorkerInterval);
  }

  console.log(`[StatusWorker] Memulai worker monitoring status perangkat (setiap ${intervalSeconds} detik)...`);

  // Jalankan segera sekali
  runDeviceStatusCycle().catch((err) => {
    console.error("[StatusWorker] Error pada siklus awal:", err);
  });

  statusWorkerInterval = setInterval(() => {
    runDeviceStatusCycle().catch((err) => {
      console.error("[StatusWorker] Error pada siklus terjadwal:", err);
    });
  }, intervalSeconds * 1000);
}

export function stopDeviceStatusWorker(): void {
  if (statusWorkerInterval) {
    clearInterval(statusWorkerInterval);
    statusWorkerInterval = null;
  }
}
