import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { analyzeIncident, analyzeDeviceDaily } from "@shared/ai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir. Silakan login kembali." },
        { status: 401 }
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Format request body tidak valid." },
        { status: 400 }
      );
    }

    const { incidentId, deviceId, mode, force } = body;

    // Mode 1: Analisa Insiden Spesifik
    if (incidentId) {
      const result = await analyzeIncident(incidentId, Boolean(force));
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Gagal memproses analisa AI." },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, analysis: result.data });
    }

    // Mode 2: Ringkasan Harian Perangkat
    if (deviceId && mode === "daily") {
      const result = await analyzeDeviceDaily(deviceId);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Gagal membuat ringkasan AI harian." },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, analysis: result.data });
    }

    return NextResponse.json(
      { error: "Parameter 'incidentId' atau 'deviceId' wajib disertakan." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("AI Analysis Route Error:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan internal saat memproses analisa AI." },
      { status: 500 }
    );
  }
}
