import { db } from "../db";
import { logEvents, devices } from "../schema";
import { sql, eq, and, gt } from "drizzle-orm";
import { RuleMatch, DetectionThresholds, IncidentEvidenceItem } from "./types";

/**
 * 1. Rule: Brute Force Login (>= 10 login gagal dari IP sama dalam 5 menit)
 */
export async function detectBruteForceLogin(
  thresholds: DetectionThresholds,
  allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = thresholds.brute_force_login.window_minutes;
  const maxFailures = thresholds.brute_force_login.max_failures;

  // Cari agregasi IP dengan kegagalan login >= threshold
  const candidates = await db.execute<{
    device_id: string;
    src_ip: string;
    fail_count: string;
    first_seen: string;
    last_seen: string;
  }>(sql`
    SELECT
      device_id,
      parsed->>'src_ip' AS src_ip,
      COUNT(*)::text AS fail_count,
      MIN(event_time)::text AS first_seen,
      MAX(event_time)::text AS last_seen
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND (
        (parsed->>'action' = 'login' AND parsed->>'outcome' = 'failure')
        OR (category = 'auth' AND parsed->>'outcome' = 'failure')
      )
      AND parsed->>'src_ip' IS NOT NULL
      AND parsed->>'src_ip' != ''
    GROUP BY device_id, parsed->>'src_ip'
    HAVING COUNT(*) >= ${maxFailures}
  `);

  const matches: RuleMatch[] = [];

  for (const row of candidates) {
    const srcIp = row.src_ip;
    if (allowlist.has(srcIp)) continue;

    const count = parseInt(row.fail_count, 10);

    // Ambil bukti (evidence) maks 20 event
    const evidenceRows = await db.execute<{
      id: string;
      event_time: string;
      message: string;
      parsed: Record<string, unknown>;
    }>(sql`
      SELECT id, event_time::text, message, parsed
      FROM log_events
      WHERE device_id = ${row.device_id}::uuid
        AND parsed->>'src_ip' = ${srcIp}
        AND event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
        AND (
          (parsed->>'action' = 'login' AND parsed->>'outcome' = 'failure')
          OR (category = 'auth' AND parsed->>'outcome' = 'failure')
        )
      ORDER BY event_time DESC
      LIMIT 20
    `);

    const evidence: IncidentEvidenceItem[] = evidenceRows.map((e) => ({
      eventId: e.id,
      timestamp: e.event_time,
      message: e.message,
      src_ip: srcIp,
      actor: (e.parsed?.actor as string) || null,
      action: "login",
      outcome: "failure",
    }));

    matches.push({
      ruleKey: "brute_force_login",
      deviceId: row.device_id,
      severity: "high",
      title: `Percobaan Brute Force Login dari IP ${srcIp}`,
      mainEntity: srcIp,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      count,
      evidence,
    });
  }

  return matches;
}

/**
 * 2. Rule: Password Spray (1 IP mencoba >= 5 username berbeda dalam 10 menit)
 */
export async function detectPasswordSpray(
  thresholds: DetectionThresholds,
  allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = thresholds.password_spray.window_minutes;
  const maxUsers = thresholds.password_spray.max_users;

  const candidates = await db.execute<{
    device_id: string;
    src_ip: string;
    unique_users: string;
    total_attempts: string;
    first_seen: string;
    last_seen: string;
  }>(sql`
    SELECT
      device_id,
      parsed->>'src_ip' AS src_ip,
      COUNT(DISTINCT parsed->>'actor')::text AS unique_users,
      COUNT(*)::text AS total_attempts,
      MIN(event_time)::text AS first_seen,
      MAX(event_time)::text AS last_seen
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND (
        (parsed->>'action' = 'login' AND parsed->>'outcome' = 'failure')
        OR (category = 'auth' AND parsed->>'outcome' = 'failure')
      )
      AND parsed->>'src_ip' IS NOT NULL
      AND parsed->>'actor' IS NOT NULL
    GROUP BY device_id, parsed->>'src_ip'
    HAVING COUNT(DISTINCT parsed->>'actor') >= ${maxUsers}
  `);

  const matches: RuleMatch[] = [];

  for (const row of candidates) {
    const srcIp = row.src_ip;
    if (allowlist.has(srcIp)) continue;

    const uniqueUsers = parseInt(row.unique_users, 10);
    const totalAttempts = parseInt(row.total_attempts, 10);

    const evidenceRows = await db.execute<{
      id: string;
      event_time: string;
      message: string;
      parsed: Record<string, unknown>;
    }>(sql`
      SELECT id, event_time::text, message, parsed
      FROM log_events
      WHERE device_id = ${row.device_id}::uuid
        AND parsed->>'src_ip' = ${srcIp}
        AND event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
        AND (
          (parsed->>'action' = 'login' AND parsed->>'outcome' = 'failure')
          OR (category = 'auth' AND parsed->>'outcome' = 'failure')
        )
      ORDER BY event_time DESC
      LIMIT 20
    `);

    const evidence: IncidentEvidenceItem[] = evidenceRows.map((e) => ({
      eventId: e.id,
      timestamp: e.event_time,
      message: e.message,
      src_ip: srcIp,
      actor: (e.parsed?.actor as string) || null,
      action: "login",
      outcome: "failure",
    }));

    matches.push({
      ruleKey: "password_spray",
      deviceId: row.device_id,
      severity: "high",
      title: `Indikasi Password Spray dari IP ${srcIp} (${uniqueUsers} akun berbeda dicoba)`,
      mainEntity: srcIp,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      count: totalAttempts,
      evidence,
    });
  }

  return matches;
}

/**
 * 3. Rule: Success After Failures (Login berhasil setelah >= 5 kegagalan dari IP sama)
 */
export async function detectSuccessAfterFailures(
  thresholds: DetectionThresholds,
  allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = thresholds.success_after_failures.window_minutes;
  const minFailures = thresholds.success_after_failures.min_failures;

  // Cari IP yang memiliki login sukses dalam window dan sebelumnya gagal >= minFailures
  const candidates = await db.execute<{
    device_id: string;
    src_ip: string;
    success_user: string;
    fail_count: string;
    first_seen: string;
    success_time: string;
  }>(sql`
    WITH SuccessLogins AS (
      SELECT
        device_id,
        parsed->>'src_ip' AS src_ip,
        parsed->>'actor' AS success_user,
        event_time AS success_time
      FROM log_events
      WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
        AND parsed->>'action' = 'login'
        AND parsed->>'outcome' = 'success'
        AND parsed->>'src_ip' IS NOT NULL
        AND parsed->>'src_ip' != ''
    ),
    FailedLogins AS (
      SELECT
        f.device_id,
        f.parsed->>'src_ip' AS src_ip,
        COUNT(*)::text AS fail_count,
        MIN(f.event_time)::text AS first_fail_time
      FROM log_events f
      JOIN SuccessLogins s
        ON f.device_id = s.device_id
       AND f.parsed->>'src_ip' = s.src_ip
       AND f.event_time < s.success_time
      WHERE f.event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
        AND (
          (f.parsed->>'action' = 'login' AND f.parsed->>'outcome' = 'failure')
          OR (f.category = 'auth' AND f.parsed->>'outcome' = 'failure')
        )
      GROUP BY f.device_id, f.parsed->>'src_ip'
      HAVING COUNT(*) >= ${minFailures}
    )
    SELECT
      s.device_id,
      s.src_ip,
      s.success_user,
      f.fail_count,
      f.first_fail_time AS first_seen,
      s.success_time::text AS success_time
    FROM SuccessLogins s
    JOIN FailedLogins f
      ON s.device_id = f.device_id
     AND s.src_ip = f.src_ip
  `);

  const matches: RuleMatch[] = [];

  for (const row of candidates) {
    const srcIp = row.src_ip;
    if (allowlist.has(srcIp)) continue;

    const count = parseInt(row.fail_count, 10) + 1;

    const evidenceRows = await db.execute<{
      id: string;
      event_time: string;
      message: string;
      parsed: Record<string, unknown>;
    }>(sql`
      SELECT id, event_time::text, message, parsed
      FROM log_events
      WHERE device_id = ${row.device_id}::uuid
        AND parsed->>'src_ip' = ${srcIp}
        AND event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      ORDER BY event_time DESC
      LIMIT 20
    `);

    const evidence: IncidentEvidenceItem[] = evidenceRows.map((e) => ({
      eventId: e.id,
      timestamp: e.event_time,
      message: e.message,
      src_ip: srcIp,
      actor: (e.parsed?.actor as string) || null,
      action: (e.parsed?.action as string) || "login",
      outcome: (e.parsed?.outcome as string) || "unknown",
    }));

    matches.push({
      ruleKey: "success_after_failures",
      deviceId: row.device_id,
      severity: "critical",
      title: `Login Berhasil Setelah ${row.fail_count}x Kegagalan dari IP ${srcIp}`,
      mainEntity: srcIp,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.success_time),
      count,
      evidence,
    });
  }

  return matches;
}

/**
 * 4. Rule: Port Scan (1 IP menyentuh >= 20 port berbeda dalam 1 menit)
 */
export async function detectPortScan(
  thresholds: DetectionThresholds,
  allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = thresholds.port_scan.window_minutes;
  const minPorts = thresholds.port_scan.min_ports;

  const candidates = await db.execute<{
    device_id: string;
    src_ip: string;
    distinct_ports: string;
    total_packets: string;
    first_seen: string;
    last_seen: string;
  }>(sql`
    SELECT
      device_id,
      parsed->>'src_ip' AS src_ip,
      COUNT(DISTINCT COALESCE(parsed->>'dst_port', parsed->>'port'))::text AS distinct_ports,
      COUNT(*)::text AS total_packets,
      MIN(event_time)::text AS first_seen,
      MAX(event_time)::text AS last_seen
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND category = 'firewall'
      AND parsed->>'src_ip' IS NOT NULL
      AND (parsed->>'dst_port' IS NOT NULL OR parsed->>'port' IS NOT NULL)
    GROUP BY device_id, parsed->>'src_ip'
    HAVING COUNT(DISTINCT COALESCE(parsed->>'dst_port', parsed->>'port')) >= ${minPorts}
  `);

  const matches: RuleMatch[] = [];

  for (const row of candidates) {
    const srcIp = row.src_ip;
    if (allowlist.has(srcIp)) continue;

    const distinctPorts = parseInt(row.distinct_ports, 10);
    const totalPackets = parseInt(row.total_packets, 10);

    const evidenceRows = await db.execute<{
      id: string;
      event_time: string;
      message: string;
      parsed: Record<string, unknown>;
    }>(sql`
      SELECT id, event_time::text, message, parsed
      FROM log_events
      WHERE device_id = ${row.device_id}::uuid
        AND parsed->>'src_ip' = ${srcIp}
        AND category = 'firewall'
        AND event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      ORDER BY event_time DESC
      LIMIT 20
    `);

    const evidence: IncidentEvidenceItem[] = evidenceRows.map((e) => ({
      eventId: e.id,
      timestamp: e.event_time,
      message: e.message,
      src_ip: srcIp,
      action: (e.parsed?.action as string) || "packet",
      outcome: (e.parsed?.outcome as string) || "failure",
      details: {
        dst_port: e.parsed?.dst_port,
        dst_ip: e.parsed?.dst_ip,
      },
    }));

    matches.push({
      ruleKey: "port_scan",
      deviceId: row.device_id,
      severity: "medium",
      title: `Pemindaian Port (Port Scan) dari IP ${srcIp} (${distinctPorts} port disentuh)`,
      mainEntity: srcIp,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      count: totalPackets,
      evidence,
    });
  }

  return matches;
}

/**
 * 5. Rule: New Admin Account (Akun baru dibuat atau ditambahkan ke grup admin)
 */
export async function detectNewAdminAccount(
  _thresholds: DetectionThresholds,
  _allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = 10;

  // Windows EventID 4720 (User Create) atau 4732 (Group Member Add ke Administrators)
  // Atau MikroTik user added / user changed configuration at /user
  const rows = await db.execute<{
    id: string;
    device_id: string;
    event_time: string;
    message: string;
    parsed: Record<string, unknown>;
  }>(sql`
    SELECT id, device_id, event_time::text, message, parsed
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND (
        (parsed->>'eventId' = '4720')
        OR (parsed->>'eventId' = '4732' AND parsed->>'group_name' ILIKE '%Admin%')
        OR (parsed->>'action' = 'user_create')
        OR (parsed->>'action' = 'group_member_add' AND parsed->>'group_name' ILIKE '%Admin%')
        OR (message ILIKE '%user % added%' AND message ILIKE '%group=full%')
      )
    ORDER BY event_time DESC
    LIMIT 50
  `);

  const matches: RuleMatch[] = [];

  for (const row of rows) {
    const target =
      (row.parsed?.target_user as string) ||
      (row.parsed?.member_name as string) ||
      (row.parsed?.actor as string) ||
      "admin_target";

    matches.push({
      ruleKey: "new_admin_account",
      deviceId: row.device_id,
      severity: "high",
      title: `Pembuatan / Penambahan Akun Administrator: ${target}`,
      mainEntity: target,
      firstSeen: new Date(row.event_time),
      lastSeen: new Date(row.event_time),
      count: 1,
      evidence: [
        {
          eventId: row.id,
          timestamp: row.event_time,
          message: row.message,
          actor: (row.parsed?.actor as string) || null,
          action: (row.parsed?.action as string) || "user_create",
          outcome: "success",
          details: row.parsed,
        },
      ],
    });
  }

  return matches;
}

/**
 * 6. Rule: Log Cleared (Windows EventID 1102 atau log service di-reset)
 */
export async function detectLogCleared(
  _thresholds: DetectionThresholds,
  _allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = 10;

  const rows = await db.execute<{
    id: string;
    device_id: string;
    event_time: string;
    message: string;
    parsed: Record<string, unknown>;
  }>(sql`
    SELECT id, device_id, event_time::text, message, parsed
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND (
        parsed->>'eventId' = '1102'
        OR parsed->>'action' = 'log_cleared'
        OR message ILIKE '%audit log%cleared%'
        OR message ILIKE '%log service was reset%'
      )
    ORDER BY event_time DESC
    LIMIT 20
  `);

  const matches: RuleMatch[] = [];

  for (const row of rows) {
    matches.push({
      ruleKey: "log_cleared",
      deviceId: row.device_id,
      severity: "critical",
      title: `Pembersihan Log Audit Keamanan (Anti-Forensik) Terdeteksi`,
      mainEntity: "SecurityLog",
      firstSeen: new Date(row.event_time),
      lastSeen: new Date(row.event_time),
      count: 1,
      evidence: [
        {
          eventId: row.id,
          timestamp: row.event_time,
          message: row.message,
          actor: (row.parsed?.actor as string) || null,
          action: "log_cleared",
          outcome: "success",
          details: row.parsed,
        },
      ],
    });
  }

  return matches;
}

/**
 * 7. Rule: Config Changed (Perubahan konfigurasi MikroTik atau service baru 7045)
 */
export async function detectConfigChanged(
  _thresholds: DetectionThresholds,
  _allowlist: Set<string>
): Promise<RuleMatch[]> {
  const windowMinutes = 10;

  const rows = await db.execute<{
    id: string;
    device_id: string;
    event_time: string;
    message: string;
    parsed: Record<string, unknown>;
  }>(sql`
    SELECT id, device_id, event_time::text, message, parsed
    FROM log_events
    WHERE event_time >= NOW() - (${windowMinutes} || ' minutes')::interval
      AND (
        parsed->>'eventId' = '7045'
        OR parsed->>'action' = 'service_install'
        OR (category = 'config' AND parsed->>'action' = 'config_change')
      )
    ORDER BY event_time DESC
    LIMIT 30
  `);

  const matches: RuleMatch[] = [];

  for (const row of rows) {
    const entity =
      (row.parsed?.service_name as string) ||
      (row.parsed?.command as string) ||
      (row.parsed?.actor as string) ||
      "SystemConfig";

    matches.push({
      ruleKey: "config_changed",
      deviceId: row.device_id,
      severity: "medium",
      title: `Perubahan Konfigurasi Sistem / Layanan Baru: ${entity}`,
      mainEntity: entity.slice(0, 150),
      firstSeen: new Date(row.event_time),
      lastSeen: new Date(row.event_time),
      count: 1,
      evidence: [
        {
          eventId: row.id,
          timestamp: row.event_time,
          message: row.message,
          actor: (row.parsed?.actor as string) || null,
          action: (row.parsed?.action as string) || "config_change",
          outcome: "success",
          details: row.parsed,
        },
      ],
    });
  }

  return matches;
}

/**
 * 8. Rule: Device Silent (Perangkat aktif tidak mengirim log selama 15 menit)
 */
export async function detectDeviceSilent(
  thresholds: DetectionThresholds,
  _allowlist: Set<string>
): Promise<RuleMatch[]> {
  const silentMinutes = thresholds.device_silent_minutes;

  // Cari perangkat yang aktif, sudah dibuat lebih dari 15 menit lalu,
  // dan (last_seen_at < 15 menit lalu ATAU last_seen_at IS NULL)
  const silentDevices = await db
    .select({
      id: devices.id,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(
      and(
        eq(devices.isActive, true),
        sql`${devices.createdAt} <= NOW() - (${silentMinutes} || ' minutes')::interval`,
        sql`(${devices.lastSeenAt} IS NULL OR ${devices.lastSeenAt} <= NOW() - (${silentMinutes} || ' minutes')::interval)`
      )
    );

  const matches: RuleMatch[] = [];

  for (const dev of silentDevices) {
    const lastSeenDate = dev.lastSeenAt ? new Date(dev.lastSeenAt) : new Date(dev.createdAt);

    matches.push({
      ruleKey: "device_silent",
      deviceId: dev.id,
      severity: "medium",
      title: `Perangkat "${dev.name}" Berhenti Mengirim Log (> ${silentMinutes} Menit)`,
      mainEntity: dev.name,
      firstSeen: lastSeenDate,
      lastSeen: new Date(),
      count: 1,
      evidence: [
        {
          eventId: `silent_${dev.id}`,
          timestamp: new Date().toISOString(),
          message: `Perangkat ${dev.name} belum mengirim event log sejak ${lastSeenDate.toISOString()}`,
          details: {
            deviceId: dev.id,
            deviceName: dev.name,
            silentSince: lastSeenDate.toISOString(),
          },
        },
      ],
    });
  }

  return matches;
}

/**
 * 9. Rule: Log Burst (Volume log 5 menit terakhir > 5x rata-rata 1 jam terakhir)
 */
export async function detectLogBurst(
  thresholds: DetectionThresholds,
  _allowlist: Set<string>
): Promise<RuleMatch[]> {
  const multiplier = thresholds.log_burst_multiplier;

  // Hitung volume log 5 menit vs 60 menit terakhir per perangkat
  const bursts = await db.execute<{
    device_id: string;
    device_name: string;
    recent_count: string;
    hourly_count: string;
  }>(sql`
    SELECT
      d.id AS device_id,
      d.name AS device_name,
      COUNT(CASE WHEN l.event_time >= NOW() - INTERVAL '5 minutes' THEN 1 END)::text AS recent_count,
      COUNT(l.id)::text AS hourly_count
    FROM devices d
    JOIN log_events l ON d.id = l.device_id
    WHERE d.is_active = true
      AND l.event_time >= NOW() - INTERVAL '60 minutes'
    GROUP BY d.id, d.name
    HAVING COUNT(CASE WHEN l.event_time >= NOW() - INTERVAL '5 minutes' THEN 1 END) >= 100
  `);

  const matches: RuleMatch[] = [];

  for (const row of bursts) {
    const recent = parseInt(row.recent_count, 10);
    const hourly = parseInt(row.hourly_count, 10);

    // Rata-rata 5-menitan dari sisa 55 menit sebelumnya:
    const olderCount = Math.max(0, hourly - recent);
    const avgPer5Min = olderCount / 11; // 55 menit / 5 = 11 intervals

    if (recent > multiplier * Math.max(avgPer5Min, 10)) {
      matches.push({
        ruleKey: "log_burst",
        deviceId: row.device_id,
        severity: "medium",
        title: `Lonjakan Volume Log (Log Burst > ${multiplier}x) pada "${row.device_name}"`,
        mainEntity: row.device_name,
        firstSeen: new Date(Date.now() - 5 * 60 * 1000),
        lastSeen: new Date(),
        count: recent,
        evidence: [
          {
            eventId: `burst_${row.device_id}`,
            timestamp: new Date().toISOString(),
            message: `Volume log mencapai ${recent} event dalam 5 menit terakhir (rata-rata normal: ${Math.round(
              avgPer5Min
            )} event / 5 menit)`,
            details: {
              recentCount5Min: recent,
              average5Min: Math.round(avgPer5Min),
              hourlyTotal: hourly,
            },
          },
        ],
      });
    }
  }

  return matches;
}

/**
 * 10. Rule: Log Flood (Pesan berulang membanjiri perangkat)
 * Kriteria:
 * - Satu pola pesan > 30x per menit selama 3 menit (>= 90 pesan dalam 3 menit), ATAU
 * - Satu pola pesan > 50% dari total log perangkat dalam 10 menit (minimal 50 pesan)
 */
export async function detectLogFlood(
  _thresholds?: DetectionThresholds,
  _allowlist?: Set<string>
): Promise<RuleMatch[]> {
  const { normalizeMessage } = await import("../log-filter.js");
  const { setTemporaryFloodProtection, getPatternHash } = await import("../dedupe.js");

  // 1. Ambil total event log per perangkat dalam 10 menit terakhir
  const deviceTotals = await db.execute<{
    device_id: string;
    total_events: string;
  }>(sql`
    SELECT
      device_id,
      COALESCE(SUM(repeat_count), COUNT(*))::text AS total_events
    FROM log_events
    WHERE event_time >= NOW() - INTERVAL '10 minutes'
    GROUP BY device_id
  `);

  const totalMap = new Map<string, number>();
  for (const row of deviceTotals) {
    totalMap.set(row.device_id, parseInt(row.total_events, 10));
  }

  // 2. Ambil pola pesan teratas dalam 10 menit terakhir
  const candidatePatterns = await db.execute<{
    device_id: string;
    device_name: string;
    sample_message: string;
    total_count: string;
    count_3min: string;
    first_time: string;
    last_time: string;
  }>(sql`
    SELECT
      l.device_id,
      d.name AS device_name,
      MIN(l.message) AS sample_message,
      COALESCE(SUM(l.repeat_count), COUNT(*))::text AS total_count,
      COALESCE(SUM(CASE WHEN l.event_time >= NOW() - INTERVAL '3 minutes' THEN l.repeat_count ELSE 0 END), 0)::text AS count_3min,
      MIN(l.event_time)::text AS first_time,
      MAX(l.event_time)::text AS last_time
    FROM log_events l
    JOIN devices d ON d.id = l.device_id
    WHERE l.event_time >= NOW() - INTERVAL '10 minutes'
    GROUP BY l.device_id, d.name, l.message
    HAVING COALESCE(SUM(l.repeat_count), COUNT(*)) >= 30
    ORDER BY COALESCE(SUM(l.repeat_count), COUNT(*)) DESC
    LIMIT 40
  `);

  const appBaseUrl = process.env.APP_BASE_URL || "jagalog.maudynetwork.id";
  const matches: RuleMatch[] = [];

  for (const row of candidatePatterns) {
    const totalCount = parseInt(row.total_count, 10);
    const count3Min = parseInt(row.count_3min, 10);
    const deviceTotal = totalMap.get(row.device_id) || totalCount;

    const ratePerMin3 = Math.round(count3Min / 3);
    const percentage = deviceTotal > 0 ? Math.round((totalCount / deviceTotal) * 100) : 100;

    // Kriteria: > 30/menit dalam 3 menit, ATAU > 50% dari log perangkat dalam 10 menit (min 50 log)
    const isRateFlood = count3Min >= 90; // > 30/menit * 3
    const isPercentFlood = percentage >= 50 && totalCount >= 50;

    if (isRateFlood || isPercentFlood) {
      const norm = normalizeMessage(row.sample_message);
      const patternHash = getPatternHash(row.sample_message);

      // Aktifkan perlindungan banjir sementara di Redis (15 menit)
      try {
        await setTemporaryFloodProtection(row.device_id, patternHash, 900);
      } catch (err) {
        console.error("[Flood Protection Error] Gagal set Redis key:", err);
      }

      // Deteksi apakah pesan mengandung domain aplikasi sendiri
      const containsAppDomain =
        row.sample_message.toLowerCase().includes(appBaseUrl.toLowerCase()) ||
        row.sample_message.toLowerCase().includes("jagalog");

      let recommendation =
        "Pesan ini kemungkinan berasal dari script atau scheduler yang memicu log baru (loop). Periksa /system scheduler dan /system script di perangkat, atau gunakan syslog sebagai pengganti fetch.";

      if (containsAppDomain) {
        recommendation = `Pesan ini mengandung domain aplikasi JagaLog (${appBaseUrl}). Ini hampir pasti loop dari script pengirim log atau fetch di MikroTik yang memicu log baru setiap kali dijalankan. Periksa /system scheduler dan /system script di perangkat, atau gunakan syslog native sebagai pengganti HTTP fetch.`;
      }

      matches.push({
        ruleKey: "log_flood",
        deviceId: row.device_id,
        severity: "medium",
        title: `Lonjakan Log Berulang (Log Flood) pada "${row.device_name}"`,
        mainEntity: norm.slice(0, 100),
        firstSeen: new Date(row.first_time),
        lastSeen: new Date(row.last_time),
        count: totalCount,
        evidence: [
          {
            eventId: `flood_${row.device_id}_${patternHash.slice(0, 8)}`,
            timestamp: row.last_time,
            message: row.sample_message,
            action: "log_flood",
            outcome: "detected",
            details: {
              normalizedPattern: norm,
              sampleMessage: row.sample_message,
              ratePerMinute: Math.max(ratePerMin3, Math.round(totalCount / 10)),
              percentageOfDeviceLogs: percentage,
              totalIn10Min: totalCount,
              count3Min,
              recommendation,
              suggestedFilter: {
                name: `Abaikan loop: ${norm.slice(0, 40)}`,
                matchType: "contains",
                pattern: row.sample_message.slice(0, 80),
                action: "discard",
              },
            },
          },
        ],
      });
    }
  }

  return matches;
}

