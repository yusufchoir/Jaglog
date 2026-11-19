import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logEvents } from "@shared/schema";
import { eq, and, desc, asc, sql, ilike } from "drizzle-orm";
import { getDeviceIngestDiagnostics } from "@shared/ingest-diagnostics";

export const dynamic = "force-dynamic";

const SEVERITY_NAMES: Record<number, string> = {
  0: "Emergency",
  1: "Alert",
  2: "Critical",
  3: "Error",
  4: "Warning",
  5: "Notice",
  6: "Informational",
  7: "Debug",
};

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const startTime = performance.now();
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const deviceId = params.id;
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim();
    const severityParam = searchParams.get("severity");
    const category = searchParams.get("category");
    const sourceApp = searchParams.get("app") || searchParams.get("sourceApp");
    const srcIp = searchParams.get("srcIp")?.trim();
    const actor = searchParams.get("actor")?.trim();
    let from = searchParams.get("from");
    let to = searchParams.get("to");
    const cursor = searchParams.get("cursor"); // Format: "ISO_TIMESTAMP|ID"
    const since = searchParams.get("since"); // Format: "ISO_TIMESTAMP|ID" untuk mode live polling
    const orderDirection = searchParams.get("order")?.toLowerCase() === "asc" ? "asc" : "desc";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const isExport = searchParams.get("export") === "csv";
    const includeDetail = searchParams.get("includeDetail") === "true";

    const baseConditions = [eq(logEvents.deviceId, deviceId)];
    let searchWarning: string | null = null;

    if (search) {
      // Wajib batas waktu jika pencarian teks tanpa filter waktu
      if (!from && !to) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        from = dayAgo.toISOString();
      } else if (from && to) {
        const diffDays = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 3600 * 24);
        if (diffDays > 7) {
          searchWarning = "Pencarian teks pada rentang lebih dari 7 hari mungkin membutuhkan waktu lebih lama.";
        }
      }
      baseConditions.push(ilike(logEvents.message, `%${search}%`));
    }

    // Filter multi-severity: bisa "all", "6", atau "0,1,2,3"
    if (severityParam && severityParam !== "all") {
      const sevValues = severityParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 0 && n <= 7);

      if (sevValues.length === 1) {
        baseConditions.push(eq(logEvents.severity, sevValues[0]));
      } else if (sevValues.length > 1) {
        baseConditions.push(
          sql`${logEvents.severity} IN (${sql.join(
            sevValues.map((v) => sql`${v}`),
            sql`, `
          )})`
        );
      }
    }

    if (category && category !== "all") {
      baseConditions.push(eq(logEvents.category, category as any));
    }

    if (sourceApp && sourceApp !== "all") {
      baseConditions.push(eq(logEvents.sourceApp, sourceApp));
    }

    if (srcIp) {
      baseConditions.push(sql`${logEvents.parsed}->>'src_ip' = ${srcIp}`);
    }

    if (actor) {
      baseConditions.push(sql`${logEvents.parsed}->>'actor' = ${actor}`);
    }

    if (from) {
      baseConditions.push(sql`${logEvents.eventTime} >= ${new Date(from).toISOString()}::timestamptz`);
    }

    if (to) {
      baseConditions.push(sql`${logEvents.eventTime} <= ${new Date(to).toISOString()}::timestamptz`);
    }

    // Mode Live Increment (Ambil log baru di atas cursor 'since'):
    if (since) {
      const conditions = [...baseConditions];
      if (since.includes("|")) {
        const [sTime, sId] = since.split("|");
        conditions.push(
          sql`(${logEvents.eventTime}, ${logEvents.id}) > (${sTime}::timestamptz, ${parseInt(sId, 10)})`
        );
      } else {
        conditions.push(sql`${logEvents.eventTime} > ${since}::timestamptz`);
      }

      const newLogs = await db
        .select({
          id: logEvents.id,
          receivedAt: logEvents.receivedAt,
          eventTime: logEvents.eventTime,
          severity: logEvents.severity,
          facility: logEvents.facility,
          sourceApp: logEvents.sourceApp,
          category: logEvents.category,
          message: logEvents.message,
          raw: logEvents.raw,
          parsed: logEvents.parsed,
        })
        .from(logEvents)
        .where(and(...conditions))
        .orderBy(desc(logEvents.eventTime), desc(logEvents.id))
        .limit(100);

      return NextResponse.json({
        logs: newLogs,
        count: newLogs.length,
      });
    }

    // Salinan kondisi untuk kueri daftar (menyertakan kursor jika ada)
    const queryConditions = [...baseConditions];

    if (cursor) {
      if (cursor.includes("|")) {
        const [cTime, cId] = cursor.split("|");
        const parsedId = parseInt(cId, 10);
        if (orderDirection === "asc") {
          queryConditions.push(
            sql`(${logEvents.eventTime}, ${logEvents.id}) > (${cTime}::timestamptz, ${parsedId})`
          );
        } else {
          queryConditions.push(
            sql`(${logEvents.eventTime}, ${logEvents.id}) < (${cTime}::timestamptz, ${parsedId})`
          );
        }
      } else {
        if (orderDirection === "asc") {
          queryConditions.push(sql`${logEvents.eventTime} > ${cursor}::timestamptz`);
        } else {
          queryConditions.push(sql`${logEvents.eventTime} < ${cursor}::timestamptz`);
        }
      }
    }

    // Jika export CSV diminta:
    if (isExport) {
      const csvLogs = await db
        .select({
          id: logEvents.id,
          receivedAt: logEvents.receivedAt,
          eventTime: logEvents.eventTime,
          severity: logEvents.severity,
          facility: logEvents.facility,
          sourceApp: logEvents.sourceApp,
          category: logEvents.category,
          message: logEvents.message,
          parsed: logEvents.parsed,
        })
        .from(logEvents)
        .where(and(...queryConditions))
        .orderBy(
          orderDirection === "asc" ? asc(logEvents.eventTime) : desc(logEvents.eventTime),
          orderDirection === "asc" ? asc(logEvents.id) : desc(logEvents.id)
        )
        .limit(5000); // Batas maksimum ekspor CSV

      const csvHeader =
        "ID,Tanggal Event (WIB),Jam Event (WIB),Zona Waktu,Waktu Terima Server (WIB),Jam Perangkat Asli,Clock Skew (Detik),Severity,Severity Nama,Kategori,Aplikasi,Pesan,Aktor,IP Sumber,IP Tujuan,Aksi,Hasil\n";

      const csvRows = csvLogs.map((l) => {
        const p = (l.parsed as Record<string, any>) || {};
        const escapeCsv = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;

        const evDate = l.eventTime ? new Date(l.eventTime) : null;
        const recDate = l.receivedAt ? new Date(l.receivedAt) : null;

        const dateWib = evDate
          ? evDate.toLocaleDateString("id-ID", {
              timeZone: "Asia/Jakarta",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })
          : "";

        const timeWib = evDate
          ? evDate.toLocaleTimeString("id-ID", {
              timeZone: "Asia/Jakarta",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "";

        const recWib = recDate
          ? recDate.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
          : "";

        return [
          escapeCsv(l.id),
          escapeCsv(dateWib),
          escapeCsv(timeWib),
          escapeCsv("WIB (UTC+7)"),
          escapeCsv(recWib),
          escapeCsv(p.device_time || "-"),
          escapeCsv(p.clock_skew_seconds !== undefined ? p.clock_skew_seconds : 0),
          escapeCsv(l.severity),
          escapeCsv(SEVERITY_NAMES[l.severity] || "Unknown"),
          escapeCsv(l.category),
          escapeCsv(l.sourceApp || "-"),
          escapeCsv(l.message),
          escapeCsv(p.actor || "-"),
          escapeCsv(p.src_ip || "-"),
          escapeCsv(p.dst_ip || "-"),
          escapeCsv(p.action || "-"),
          escapeCsv(p.outcome || "-"),
        ].join(",");
      });

      const csvContent = csvHeader + csvRows.join("\n");

      return new Response(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="jagalog-logs-${deviceId.slice(0, 8)}.csv"`,
        },
      });
    }

    // Mode JSON reguler:
    const logs = await db
      .select({
        id: logEvents.id,
        receivedAt: logEvents.receivedAt,
        eventTime: logEvents.eventTime,
        severity: logEvents.severity,
        facility: logEvents.facility,
        sourceApp: logEvents.sourceApp,
        category: logEvents.category,
        message: logEvents.message,
        raw: includeDetail ? logEvents.raw : sql<string | null>`NULL`,
        parsed: includeDetail ? logEvents.parsed : sql<any>`'{}'::jsonb`,
        repeatCount: logEvents.repeatCount,
        firstEventTime: logEvents.firstEventTime,
      })
      .from(logEvents)
      .where(and(...queryConditions))
      .orderBy(
        orderDirection === "asc" ? asc(logEvents.eventTime) : desc(logEvents.eventTime),
        orderDirection === "asc" ? asc(logEvents.id) : desc(logEvents.id)
      )
      .limit(limit + 1);

    const hasNextPage = logs.length > limit;
    const items = hasNextPage ? logs.slice(0, limit) : logs;
    const nextCursor =
      hasNextPage && items.length > 0
        ? `${items[items.length - 1].eventTime?.toISOString()}|${items[items.length - 1].id}`
        : null;

    // Hitung estimasi/total log tanpa full COUNT(*) lambat
    const hasNonDeviceFilter = Boolean(
      search ||
      (severityParam && severityParam !== "all") ||
      (category && category !== "all") ||
      (sourceApp && sourceApp !== "all") ||
      srcIp ||
      actor ||
      from ||
      to
    );

    let totalCount: number | null = null;
    let isEstimated = false;
    let mergedOrDroppedCount = 0;
    let hasLogsOutsideFilter = false;

    try {
      if (!hasNonDeviceFilter) {
        // Ambil hitungan instan dari device_log_hourly
        const [hourlyRow] = await db.execute<{ stored: string; merged_dropped: string }>(sql`
          SELECT 
            COALESCE(SUM(stored_count), 0)::text as stored,
            COALESCE(SUM(received_count - stored_count + dropped_count), 0)::text as merged_dropped
          FROM device_log_hourly
          WHERE device_id = ${deviceId}::uuid
        `);
        totalCount = parseInt(hourlyRow?.stored || "0", 10);
        mergedOrDroppedCount = parseInt(hourlyRow?.merged_dropped || "0", 10);
      } else {
        // Hitungan terbatas (maks 10.001 baris) untuk mencegah full table scan lambat
        const [boundedRow] = await db.execute<{ count: string }>(sql`
          SELECT count(*)::text as count FROM (
            SELECT 1 FROM log_events
            WHERE ${and(...baseConditions)}
            LIMIT 10001
          ) sub
        `);
        const c = parseInt(boundedRow?.count || "0", 10);
        if (c >= 10001) {
          totalCount = 10000;
          isEstimated = true;
        } else {
          totalCount = c;
          isEstimated = false;
        }

        if (items.length === 0) {
          const [anyLogRow] = await db.execute<{ has_any: boolean }>(sql`
            SELECT EXISTS(
              SELECT 1 FROM log_events WHERE device_id = ${deviceId}::uuid LIMIT 1
            ) as has_any
          `);
          hasLogsOutsideFilter = Boolean(anyLogRow?.has_any);
        }
      }

      // Tambahkan pesan yang dibuang akibat rate limit dari Redis
      const { getDroppedRateLimitCount } = await import("@shared/dedupe");
      const droppedRateLimit = await getDroppedRateLimitCount(deviceId);
      mergedOrDroppedCount += droppedRateLimit;
    } catch {
      totalCount = null;
    }

    const ingestDiagnostics = await getDeviceIngestDiagnostics(deviceId);

    const responsePayload = {
      logs: items,
      nextCursor,
      hasNextPage,
      totalCount,
      isEstimated,
      mergedOrDroppedCount,
      hasLogsOutsideFilter,
      ingestDiagnostics,
      order: orderDirection,
      searchWarning,
    };

    const res = NextResponse.json(responsePayload);
    res.headers.set("Server-Timing", `total;dur=${(performance.now() - startTime).toFixed(1)}`);
    return res;
  } catch (err: any) {
    console.error("GET /api/devices/[id]/logs Error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil data event log." },
      { status: 500 }
    );
  }
}
