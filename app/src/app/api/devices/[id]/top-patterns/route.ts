import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logTopPatterns, logEvents } from "@shared/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { normalizeMessage } from "@shared/log-filter";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    const deviceId = params.id;

    // 1. Coba ambil dari tabel teragregasi log_top_patterns (24 jam terakhir)
    const aggregated = await db.execute<{
      normalized_message: string;
      example_message: string;
      total_count: string;
    }>(sql`
      SELECT
        normalized_message,
        MAX(example_message) AS example_message,
        SUM(count)::text AS total_count
      FROM log_top_patterns
      WHERE device_id = ${deviceId}
        AND hour_bucket >= NOW() - INTERVAL '24 hours'
      GROUP BY normalized_message
      ORDER BY SUM(count) DESC
      LIMIT 5
    `);

    let patterns: Array<{
      normalizedMessage: string;
      exampleMessage: string;
      count: number;
      percentage: number;
    }> = [];

    let totalCount = 0;

    if (aggregated.length > 0) {
      totalCount = aggregated.reduce((acc, r) => acc + parseInt(r.total_count, 10), 0);
      patterns = aggregated.map((r) => {
        const count = parseInt(r.total_count, 10);
        return {
          normalizedMessage: r.normalized_message,
          exampleMessage: r.example_message || r.normalized_message,
          count,
          percentage: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
        };
      });
    } else {
      // 2. Fallback jika data log_top_patterns belum terisi: agregasi dari log_events 24 jam terakhir
      const rawRows = await db.execute<{
        message: string;
        event_count: string;
      }>(sql`
        SELECT
          message,
          COALESCE(SUM(repeat_count), COUNT(*))::text AS event_count
        FROM log_events
        WHERE device_id = ${deviceId}
          AND event_time >= NOW() - INTERVAL '24 hours'
        GROUP BY message
        ORDER BY COALESCE(SUM(repeat_count), COUNT(*)) DESC
        LIMIT 20
      `);

      if (rawRows.length > 0) {
        // Normalisasi dan grupkan di JavaScript
        const groupMap = new Map<string, { example: string; count: number }>();
        let grandTotal = 0;

        for (const row of rawRows) {
          const norm = normalizeMessage(row.message);
          const c = parseInt(row.event_count, 10);
          grandTotal += c;

          const existing = groupMap.get(norm);
          if (existing) {
            existing.count += c;
          } else {
            groupMap.set(norm, { example: row.message, count: c });
          }
        }

        const sorted = Array.from(groupMap.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5);

        patterns = sorted.map(([norm, val]) => ({
          normalizedMessage: norm,
          exampleMessage: val.example,
          count: val.count,
          percentage: grandTotal > 0 ? Math.round((val.count / grandTotal) * 100) : 0,
        }));
        totalCount = grandTotal;
      }
    }

    return NextResponse.json({
      patterns,
      totalCount,
    });
  } catch (err: any) {
    console.error("GET /api/devices/[id]/top-patterns Error:", err);
    return NextResponse.json({ error: "Gagal memuat pola log teratas." }, { status: 500 });
  }
}
