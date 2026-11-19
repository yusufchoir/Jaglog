import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logEvents } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const BATCH_DELETE_SIZE = 5000;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat menghapus data log." },
        { status: 403 }
      );
    }

    const deviceId = params.id;
    const body = await request.json();
    const { pattern, matchType = "contains", from, to, dryRun = false } = body;

    if (!pattern || pattern.trim().length === 0) {
      return NextResponse.json({ error: "Pola pesan yang akan dibersihkan wajib diisi." }, { status: 400 });
    }

    const trimmedPattern = pattern.trim();
    const conditions = [
      sql`device_id = ${deviceId}`,
      ...(from ? [sql`event_time >= ${new Date(from).toISOString()}::timestamptz`] : []),
      ...(to ? [sql`event_time <= ${new Date(to).toISOString()}::timestamptz`] : []),
    ];

    if (matchType === "exact") {
      conditions.push(sql`message = ${trimmedPattern}`);
    } else {
      // Default: contains
      conditions.push(sql`message ILIKE ${"%" + trimmedPattern + "%"}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    // 1. Jika mode dry-run: hanya hitung jumlah baris yang cocok
    if (dryRun) {
      const countRes = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM log_events
        WHERE ${whereClause}
      `);
      const totalToClean = parseInt(countRes[0]?.count || "0", 10);
      return NextResponse.json({
        totalToClean,
        batchSize: BATCH_DELETE_SIZE,
        pattern: trimmedPattern,
      });
    }

    // 2. Eksekusi penghapusan bertahap per 5.000 baris agar tidak mengunci tabel
    let totalDeleted = 0;
    let keepDeleting = true;
    let iteration = 0;
    const MAX_ITERATIONS = 200; // Maksimal 1.000.000 baris per panggilan

    while (keepDeleting && iteration < MAX_ITERATIONS) {
      iteration++;
      const deleteResult = await db.execute<{ deleted_count: string }>(sql`
        WITH to_delete AS (
          SELECT id
          FROM log_events
          WHERE ${whereClause}
          LIMIT ${BATCH_DELETE_SIZE}
        )
        DELETE FROM log_events
        WHERE id IN (SELECT id FROM to_delete)
        RETURNING id
      `);

      const deletedInBatch = deleteResult.length;
      totalDeleted += deletedInBatch;

      if (deletedInBatch < BATCH_DELETE_SIZE) {
        keepDeleting = false;
      }
    }

    console.log(
      `[AUDIT] [${new Date().toISOString()}] Admin '${session.user.username}' cleaned ${totalDeleted} flood logs from device ${deviceId} matching '${trimmedPattern}'`
    );

    return NextResponse.json({
      message: `Berhasil membersihkan ${totalDeleted.toLocaleString("id-ID")} baris log banjir.`,
      totalDeleted,
    });
  } catch (err: any) {
    console.error("POST /api/devices/[id]/logs/cleanup Error:", err);
    return NextResponse.json({ error: "Gagal membersihkan data log." }, { status: 500 });
  }
}
