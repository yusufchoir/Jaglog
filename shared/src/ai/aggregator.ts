import { db } from "../db";
import { devices, incidents, logEvents } from "../schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { maskSensitiveData } from "./masker";

export interface AggregatedIncidentContext {
  incident: {
    id: string;
    ruleKey: string;
    title: string;
    severity: string;
    firstSeen: string;
    lastSeen: string;
    count: number;
    mainEntity: string | null;
  };
  device: {
    id: string;
    name: string;
    type: string;
    ipAddress: string | null;
    location: string | null;
  };
  sampleLogs: Array<{
    eventId: string;
    time: string;
    severity: number;
    category: string;
    message: string;
    parsed: Record<string, unknown>;
  }>;
}

export interface AggregatedDeviceDailyContext {
  device: {
    id: string;
    name: string;
    type: string;
    ipAddress: string | null;
  };
  period: {
    start: string;
    end: string;
  };
  stats: {
    totalLogs: number;
    severityDistribution: Record<string, number>;
    categoryDistribution: Record<string, number>;
    topSourceIps: Array<{ ip: string; count: number }>;
    topAccounts: Array<{ account: string; count: number }>;
  };
  activeIncidents: Array<{
    ruleKey: string;
    severity: string;
    title: string;
    count: number;
  }>;
  sampleLogs: Array<{
    time: string;
    severity: number;
    message: string;
  }>;
}

/**
 * Mempersiapkan payload teragregasi dan termasker untuk analisa satu insiden
 */
export async function buildIncidentContext(incidentId: string): Promise<AggregatedIncidentContext | null> {
  // 1. Ambil data insiden
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!incident) return null;

  // 2. Ambil data perangkat
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, incident.deviceId))
    .limit(1);

  if (!device) return null;

  // 3. Ambil maksimal 30 event contoh yang relevan
  // Prioritaskan dari entitas utama atau rentang waktu insiden
  let sampleLogs: any[] = [];

  if (incident.mainEntity && incident.mainEntity !== "-") {
    sampleLogs = await db
      .select({
        id: logEvents.id,
        eventTime: logEvents.eventTime,
        severity: logEvents.severity,
        category: logEvents.category,
        message: logEvents.message,
        parsed: logEvents.parsed,
      })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, device.id),
          sql`(${logEvents.parsed}->>'src_ip' = ${incident.mainEntity} OR ${logEvents.parsed}->>'actor' = ${incident.mainEntity} OR ${logEvents.message} ILIKE ${"%" + incident.mainEntity + "%"})`
        )
      )
      .orderBy(desc(logEvents.eventTime))
      .limit(30);
  }

  // Fallback jika tidak menemukan dari mainEntity: ambil 30 log terakhir di sekitar insiden
  if (sampleLogs.length === 0) {
    sampleLogs = await db
      .select({
        id: logEvents.id,
        eventTime: logEvents.eventTime,
        severity: logEvents.severity,
        category: logEvents.category,
        message: logEvents.message,
        parsed: logEvents.parsed,
      })
      .from(logEvents)
      .where(eq(logEvents.deviceId, device.id))
      .orderBy(desc(logEvents.eventTime))
      .limit(30);
  }

  // Masker seluruh data teks sensitif
  const maskedSampleLogs = sampleLogs.map((log) => ({
    eventId: log.id,
    time: log.eventTime ? new Date(log.eventTime).toISOString() : "",
    severity: log.severity,
    category: log.category,
    message: maskSensitiveData(log.message),
    parsed: log.parsed as Record<string, unknown>,
  }));

  return {
    incident: {
      id: incident.id,
      ruleKey: incident.ruleKey,
      title: incident.title,
      severity: incident.severity,
      firstSeen: new Date(incident.firstSeen).toISOString(),
      lastSeen: new Date(incident.lastSeen).toISOString(),
      count: incident.count,
      mainEntity: incident.mainEntity,
    },
    device: {
      id: device.id,
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      location: device.location,
    },
    sampleLogs: maskedSampleLogs,
  };
}

/**
 * Mempersiapkan payload teragregasi untuk ringkasan harian perangkat (24 jam terakhir)
 */
export async function buildDeviceDailyContext(deviceId: string): Promise<AggregatedDeviceDailyContext | null> {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  if (!device) return null;

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Agregasi distribusi severity & kategori
  const [totalCountRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(logEvents)
    .where(
      and(
        eq(logEvents.deviceId, deviceId),
        sql`${logEvents.eventTime} >= NOW() - INTERVAL '24 hours'`
      )
    );

  const totalLogs = parseInt(totalCountRow?.count || "0", 10);
  if (totalLogs === 0) return null; // Tidak ada aktivitas

  // 2. Distribusi severity
  const sevRows = await db.execute<{ severity: string; count: string }>(sql`
    SELECT severity::text, COUNT(*)::text as count
    FROM log_events
    WHERE device_id = ${deviceId}::uuid
      AND event_time >= NOW() - INTERVAL '24 hours'
    GROUP BY severity
  `);
  const severityDistribution: Record<string, number> = {};
  for (const r of sevRows) {
    severityDistribution[r.severity] = parseInt(r.count, 10);
  }

  // 3. Distribusi kategori
  const catRows = await db.execute<{ category: string; count: string }>(sql`
    SELECT category, COUNT(*)::text as count
    FROM log_events
    WHERE device_id = ${deviceId}::uuid
      AND event_time >= NOW() - INTERVAL '24 hours'
    GROUP BY category
  `);
  const categoryDistribution: Record<string, number> = {};
  for (const r of catRows) {
    categoryDistribution[r.category] = parseInt(r.count, 10);
  }

  // 4. Top Source IPs
  const ipRows = await db.execute<{ ip: string; count: string }>(sql`
    SELECT parsed->>'src_ip' AS ip, COUNT(*)::text as count
    FROM log_events
    WHERE device_id = ${deviceId}::uuid
      AND event_time >= NOW() - INTERVAL '24 hours'
      AND parsed->>'src_ip' IS NOT NULL
      AND parsed->>'src_ip' != ''
    GROUP BY parsed->>'src_ip'
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `);
  const topSourceIps = ipRows.map((r) => ({ ip: r.ip, count: parseInt(r.count, 10) }));

  // 5. Top Accounts
  const accRows = await db.execute<{ account: string; count: string }>(sql`
    SELECT parsed->>'actor' AS account, COUNT(*)::text as count
    FROM log_events
    WHERE device_id = ${deviceId}::uuid
      AND event_time >= NOW() - INTERVAL '24 hours'
      AND parsed->>'actor' IS NOT NULL
      AND parsed->>'actor' != ''
    GROUP BY parsed->>'actor'
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `);
  const topAccounts = accRows.map((r) => ({ account: r.account, count: parseInt(r.count, 10) }));

  // 6. Insiden aktif 24 jam terakhir
  const activeIncidents = await db
    .select({
      ruleKey: incidents.ruleKey,
      severity: incidents.severity,
      title: incidents.title,
      count: incidents.count,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.deviceId, deviceId),
        sql`${incidents.lastSeen} >= NOW() - INTERVAL '24 hours'`
      )
    );

  // 7. Maksimal 20 sampel log relevan termasker
  const samples = await db
    .select({
      eventTime: logEvents.eventTime,
      severity: logEvents.severity,
      message: logEvents.message,
    })
    .from(logEvents)
    .where(
      and(
        eq(logEvents.deviceId, deviceId),
        sql`${logEvents.eventTime} >= NOW() - INTERVAL '24 hours'`
      )
    )
    .orderBy(desc(logEvents.eventTime))
    .limit(20);

  const sampleLogs = samples.map((s) => ({
    time: s.eventTime ? new Date(s.eventTime).toISOString() : "",
    severity: s.severity,
    message: maskSensitiveData(s.message),
  }));

  return {
    device: {
      id: device.id,
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
    },
    period: {
      start: dayAgo.toISOString(),
      end: now.toISOString(),
    },
    stats: {
      totalLogs,
      severityDistribution,
      categoryDistribution,
      topSourceIps,
      topAccounts,
    },
    activeIncidents,
    sampleLogs,
  };
}
