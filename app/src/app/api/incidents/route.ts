import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { incidents, devices } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

// 1. GET /api/incidents: Daftar seluruh insiden dengan filter
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("deviceId");
    const groupId = searchParams.get("groupId");
    const severity = searchParams.get("severity");
    const status = searchParams.get("status") || "open"; // default open
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    const conditions = [];

    if (deviceId) {
      conditions.push(eq(incidents.deviceId, deviceId));
    }
    if (groupId && groupId !== "all") {
      conditions.push(eq(devices.groupId, groupId));
    }
    if (severity && severity !== "all") {
      conditions.push(eq(incidents.severity, severity));
    }
    if (status && status !== "all") {
      conditions.push(eq(incidents.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const incidentList = await db
      .select({
        id: incidents.id,
        deviceId: incidents.deviceId,
        deviceName: devices.name,
        deviceType: devices.type,
        ruleKey: incidents.ruleKey,
        severity: incidents.severity,
        title: incidents.title,
        firstSeen: incidents.firstSeen,
        lastSeen: incidents.lastSeen,
        count: incidents.count,
        status: incidents.status,
        mainEntity: incidents.mainEntity,
        evidence: incidents.evidence,
      })
      .from(incidents)
      .leftJoin(devices, eq(incidents.deviceId, devices.id))
      .where(whereClause)
      .orderBy(desc(incidents.lastSeen))
      .limit(limit);

    // Hitung ringkasan status insiden
    const statusCounts = await db.execute<{ status: string; count: string }>(sql`
      SELECT status, COUNT(*)::text as count
      FROM incidents
      GROUP BY status
    `);

    const summary = {
      open: 0,
      ack: 0,
      closed: 0,
    };
    for (const r of statusCounts) {
      if (r.status in summary) {
        summary[r.status as keyof typeof summary] = parseInt(r.count, 10);
      }
    }

    return NextResponse.json({
      incidents: incidentList,
      summary,
    });
  } catch (err: any) {
    console.error("GET /api/incidents Error:", err);
    return NextResponse.json(
      { error: "Gagal memuat daftar insiden keamanan." },
      { status: 500 }
    );
  }
}

// 2. PATCH /api/incidents: Perbarui status insiden (ack, closed, open)
export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id, status } = body;

    if (!id || !["open", "ack", "closed"].includes(status)) {
      return NextResponse.json(
        { error: "Parameter 'id' dan 'status' ('open'|'ack'|'closed') wajib valid." },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(incidents)
      .set({ status })
      .where(eq(incidents.id, id))
      .returning({ id: incidents.id, status: incidents.status, deviceId: incidents.deviceId });

    if (!updated) {
      return NextResponse.json(
        { error: "Insiden tidak ditemukan." },
        { status: 404 }
      );
    }

    publishChange({
      tipe: "insiden.berubah",
      perangkat_id: updated.deviceId,
      data_ringkas: { id_insiden: updated.id, status: updated.status },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Status insiden berhasil diubah menjadi '${status}'.`,
      incident: { id: updated.id, status: updated.status },
    });
  } catch (err: any) {
    console.error("PATCH /api/incidents Error:", err);
    return NextResponse.json(
      { error: "Gagal memperbarui status insiden." },
      { status: 500 }
    );
  }
}
