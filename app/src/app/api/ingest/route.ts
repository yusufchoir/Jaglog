import { NextResponse } from "next/server";
import { db } from "@shared/db";
import { devices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashIngestToken } from "@shared/devices";
import { enqueueLogEvents, RawLogPayload } from "@shared/queue";
import {
  recordIngestRejection,
  recordDevicePacketAccepted,
  normalizeSourceIp,
} from "@shared/ingest-diagnostics";

export const dynamic = "force-dynamic";

const MAX_EVENTS_PER_BATCH = 500;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export async function POST(request: Request) {
  try {
    const clientIp = normalizeSourceIp(
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1"
    );

    // 1. Validasi Header Autentikasi Bearer Token
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      await recordIngestRejection({
        reason: "token_salah",
        deviceId: null,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Header 'Authorization: Bearer <token>' wajib disertakan." },
        { status: 401 }
      );
    }

    const rawToken = authHeader.slice(7).trim();
    if (!rawToken) {
      await recordIngestRejection({
        reason: "token_salah",
        deviceId: null,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Token ingest tidak boleh kosong." },
        { status: 401 }
      );
    }

    // 2. Hash token dan cari perangkat di database / cache
    const tokenHash = hashIngestToken(rawToken);
    const [device] = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        isActive: devices.isActive,
      })
      .from(devices)
      .where(eq(devices.ingestTokenHash, tokenHash))
      .limit(1);

    if (!device) {
      await recordIngestRejection({
        reason: "token_salah",
        deviceId: null,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Token ingest tidak valid atau perangkat belum terdaftar." },
        { status: 401 }
      );
    }

    if (!device.isActive) {
      await recordIngestRejection({
        reason: "nonaktif",
        deviceId: device.id,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Perangkat ini sedang dinonaktifkan. Pengiriman log ditolak." },
        { status: 403 }
      );
    }

    // 3. Baca Body dan periksa batas ukuran 1 MB
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf-8") > MAX_BODY_BYTES) {
      await recordIngestRejection({
        reason: "ukuran",
        deviceId: device.id,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Ukuran muatan melebihi batas maksimum 1 MB per request." },
        { status: 413 }
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      await recordIngestRejection({
        reason: "tidak_terbaca",
        deviceId: device.id,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Format body harus berupa JSON yang valid." },
        { status: 400 }
      );
    }

    // Normalisasi body: terima array atau object tunggal
    const rawEventsArray = Array.isArray(parsedBody) ? parsedBody : [parsedBody];

    if (rawEventsArray.length === 0) {
      await recordIngestRejection({
        reason: "tidak_terbaca",
        deviceId: device.id,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        { error: "Daftar event log tidak boleh kosong." },
        { status: 400 }
      );
    }

    if (rawEventsArray.length > MAX_EVENTS_PER_BATCH) {
      await recordIngestRejection({
        reason: "ukuran",
        deviceId: device.id,
        sourceIp: clientIp,
        transport: "http",
      });
      return NextResponse.json(
        {
          error: `Jumlah event melebihi batas maksimum (${MAX_EVENTS_PER_BATCH} event per request).`,
        },
        { status: 400 }
      );
    }

    // 4. Catat waktu paket terakhir diterima untuk perangkat ini
    recordDevicePacketAccepted(device.id, clientIp, "http").catch(() => {});

    const nowIso = new Date().toISOString();

    const queuePayloads: RawLogPayload[] = rawEventsArray.map((ev: any) => {
      const msg = typeof ev === "string" ? ev : ev.message || ev.Message || JSON.stringify(ev);
      const rawText = typeof ev === "string" ? ev : ev.raw || JSON.stringify(ev);

      return {
        deviceId: device.id,
        raw: rawText,
        receivedAt: nowIso,
        eventTime: ev.eventTime || ev.event_time || ev.timestamp || nowIso,
        sourceIp: clientIp,
        severity: typeof ev.severity === "number" ? ev.severity : 6,
        facility: typeof ev.facility === "number" ? ev.facility : 1,
        sourceApp: ev.sourceApp || ev.source_app || ev.app || undefined,
        message: msg,
        category: ev.category || "other",
        parsed: typeof ev.parsed === "object" ? ev.parsed : typeof ev === "object" ? ev : {},
        deviceType: device.type,
      };
    });

    // 5. Masukkan ke antrian BullMQ ingest (Asinkron & Cepat)
    await enqueueLogEvents(queuePayloads);

    return NextResponse.json(
      {
        success: true,
        message: `${queuePayloads.length} event log berhasil diterima dan dimasukkan ke antrian.`,
        acceptedCount: queuePayloads.length,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("HTTP Ingest Error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan internal saat memproses ingest log." },
      { status: 500 }
    );
  }
}
