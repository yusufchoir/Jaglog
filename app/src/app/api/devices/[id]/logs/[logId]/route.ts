import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logEvents } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string; logId: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const deviceId = params.id;
    const logId = parseInt(params.logId, 10);

    if (isNaN(logId)) {
      return NextResponse.json(
        { error: "ID log tidak valid." },
        { status: 400 }
      );
    }

    const [log] = await db
      .select({
        id: logEvents.id,
        deviceId: logEvents.deviceId,
        receivedAt: logEvents.receivedAt,
        eventTime: logEvents.eventTime,
        severity: logEvents.severity,
        facility: logEvents.facility,
        sourceApp: logEvents.sourceApp,
        category: logEvents.category,
        message: logEvents.message,
        raw: logEvents.raw,
        parsed: logEvents.parsed,
        repeatCount: logEvents.repeatCount,
        firstEventTime: logEvents.firstEventTime,
      })
      .from(logEvents)
      .where(and(eq(logEvents.deviceId, deviceId), eq(logEvents.id, logId)))
      .limit(1);

    if (!log) {
      return NextResponse.json(
        { error: "Event log tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json({ log });
  } catch (err: any) {
    console.error("GET /api/devices/[id]/logs/[logId] Error:", err);
    return NextResponse.json(
      { error: "Gagal memuat detail event log." },
      { status: 500 }
    );
  }
}

