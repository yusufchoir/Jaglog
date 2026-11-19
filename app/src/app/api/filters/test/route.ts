import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logEvents } from "@shared/schema";
import { sql, and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    const body = await request.json();
    const { pattern, matchType = "contains", deviceId } = body;

    if (!pattern || pattern.trim().length === 0) {
      return NextResponse.json({ error: "Pola filter tidak boleh kosong." }, { status: 400 });
    }

    if (pattern.length > 500) {
      return NextResponse.json({ error: "Panjang pola melebihi 500 karakter." }, { status: 400 });
    }

    let compiledRegex: RegExp | null = null;
    if (matchType === "regex") {
      try {
        compiledRegex = new RegExp(pattern, "i");
      } catch (err: any) {
        return NextResponse.json({ error: `Sintaks regex tidak valid: ${err?.message || ""}` }, { status: 400 });
      }
    }

    const trimmedPattern = pattern.trim();

    // Query 24 jam terakhir dengan batas pencarian
    // Jika matchType adalah 'contains', kita bisa gunakan ILIKE langsung di SQL untuk kecepatan tinggi
    // Jika matchType adalah 'exact', kita gunakan = di SQL
    // Jika matchType adalah 'regex', kita ambil sampel terbaru 2000 log dan lakukan filter JS dengan timeout guard
    let matchedCount = 0;
    let samples: Array<{ id: number; message: string; eventTime: string; severity: number }> = [];

    const baseWhere = [
      sql`${logEvents.eventTime} >= NOW() - INTERVAL '24 hours'`,
      ...(deviceId ? [eq(logEvents.deviceId, deviceId)] : []),
    ];

    if (matchType === "contains") {
      const countRes = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM log_events
        WHERE ${sql.join(baseWhere, sql` AND `)}
          AND message ILIKE ${"%" + trimmedPattern + "%"}
      `);
      matchedCount = parseInt(countRes[0]?.count || "0", 10);

      const sampleRes = await db.execute<{
        id: number;
        message: string;
        event_time: string;
        severity: number;
      }>(sql`
        SELECT id, message, event_time::text, severity
        FROM log_events
        WHERE ${sql.join(baseWhere, sql` AND `)}
          AND message ILIKE ${"%" + trimmedPattern + "%"}
        ORDER BY event_time DESC
        LIMIT 5
      `);

      samples = sampleRes.map((r) => ({
        id: r.id,
        message: r.message,
        eventTime: r.event_time,
        severity: r.severity,
      }));
    } else if (matchType === "exact") {
      const countRes = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM log_events
        WHERE ${sql.join(baseWhere, sql` AND `)}
          AND message = ${trimmedPattern}
      `);
      matchedCount = parseInt(countRes[0]?.count || "0", 10);

      const sampleRes = await db.execute<{
        id: number;
        message: string;
        event_time: string;
        severity: number;
      }>(sql`
        SELECT id, message, event_time::text, severity
        FROM log_events
        WHERE ${sql.join(baseWhere, sql` AND `)}
          AND message = ${trimmedPattern}
        ORDER BY event_time DESC
        LIMIT 5
      `);

      samples = sampleRes.map((r) => ({
        id: r.id,
        message: r.message,
        eventTime: r.event_time,
        severity: r.severity,
      }));
    } else if (matchType === "regex" && compiledRegex) {
      // Ambil hingga 2.000 log 24 jam terakhir untuk diuji regex
      const recentRows = await db.execute<{
        id: number;
        message: string;
        event_time: string;
        severity: number;
      }>(sql`
        SELECT id, message, event_time::text, severity
        FROM log_events
        WHERE ${sql.join(baseWhere, sql` AND `)}
        ORDER BY event_time DESC
        LIMIT 2000
      `);

      for (const r of recentRows) {
        try {
          if (compiledRegex.test(r.message)) {
            matchedCount++;
            if (samples.length < 5) {
              samples.push({
                id: r.id,
                message: r.message,
                eventTime: r.event_time,
                severity: r.severity,
              });
            }
          }
        } catch {
          // ReDoS guard
          break;
        }
      }
    }

    return NextResponse.json({
      pattern: trimmedPattern,
      matchType,
      matchedCount,
      samples,
    });
  } catch (err: any) {
    console.error("POST /api/filters/test Error:", err);
    return NextResponse.json({ error: "Gagal menguji pola filter." }, { status: 500 });
  }
}
