import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { sseBroker } from "@/lib/sse-broker";
import { getEventsSince } from "@shared/events/publisher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // 1. Cek toggle environment LIVE_UPDATES
  if (process.env.LIVE_UPDATES === "false") {
    return new NextResponse("Pembaruan langsung dinonaktifkan oleh administrator.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // 2. Autentikasi sesi cookie pengguna
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sesi tidak valid atau telah berakhir. Silakan login kembali." },
      { status: 401 }
    );
  }

  // 3. Ekstrak parameter filter dan Last-Event-ID
  const { searchParams } = new URL(request.url);
  const perangkatParam = searchParams.get("perangkat");
  const topikParam = searchParams.get("topik");
  const lastEventId =
    request.headers.get("Last-Event-ID") || searchParams.get("lastEventId");

  const deviceFilter = perangkatParam
    ? new Set(perangkatParam.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const topicFilter = topikParam
    ? new Set(topikParam.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 4. Siapkan ReadableStream SSE
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      streamController = controller;

      // Kirim frame pembuka
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Jika ada Last-Event-ID, periksa event terlewat dalam 60 detik terakhir
      if (lastEventId) {
        try {
          const missedEvents = await getEventsSince(lastEventId, 60000);
          if (missedEvents.length > 0) {
            for (const evt of missedEvents) {
              // Saring berdasarkan filter client
              if (topicFilter && !topicFilter.has(evt.tipe)) continue;
              if (deviceFilter && evt.perangkat_id && !deviceFilter.has(evt.perangkat_id)) continue;

              const raw = JSON.stringify(evt);
              const frame = `id: ${evt.id}\nevent: ${evt.tipe}\ndata: ${raw}\n\n`;
              controller.enqueue(encoder.encode(frame));
            }
          } else {
            // Buffer kadaluarsa atau ID tidak ditemukan -> minta klien resync tampilan aktif
            controller.enqueue(encoder.encode(`event: resync\ndata: {}\n\n`));
          }
        } catch (err) {
          console.error("[SSE Stream] Gagal memproses Last-Event-ID:", err);
        }
      }

      // Daftarkan client ke broker SSE
      const registration = sseBroker.registerClient({
        id: clientId,
        userId: session.user.userId,
        deviceFilter,
        topicFilter,
        send: (payload: string) => {
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            // Controller might be closed
          }
        },
        close: () => {
          try {
            controller.close();
          } catch {}
        },
        connectedAt: Date.now(),
      });

      if (!registration.ok) {
        controller.enqueue(encoder.encode(": registration_rejected\n\n"));
        controller.close();
      }
    },
    cancel() {
      sseBroker.removeClient(clientId);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
