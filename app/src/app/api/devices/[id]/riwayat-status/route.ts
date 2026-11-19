import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import {
  timelineQuerySchema,
  calculateComprehensiveTimeline,
  VALID_RENTANG_SKALA,
  RentangOption,
  SkalaOption,
  resolveDateRange,
  getValidScalesForRange,
  calculateSlotCount,
  formatScaleChoices,
  SCALE_LABEL_MAP,
} from "@shared/monitoring";
import { redis } from "@shared/redis";
import { sanitizeForJson, safeJsonStringify } from "@shared/serialization";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const deviceId = resolvedParams?.id;

    // Validasi format UUID untuk mencegah error sintaks database 500
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!deviceId || !uuidRegex.test(deviceId)) {
      return NextResponse.json(
        { error: "Format ID perangkat tidak valid." },
        { status: 400 }
      );
    }
    const url = new URL(request.url);
    const rentangParam = url.searchParams.get("rentang") || "7h";
    const skalaParam = url.searchParams.get("skala") || "otomatis";
    const dariParam = url.searchParams.get("dari") || undefined;
    const sampaiParam = url.searchParams.get("sampai") || undefined;

    // 1. Validasi Zod query params
    const parseResult = timelineQuerySchema.safeParse({
      rentang: rentangParam,
      skala: skalaParam,
      dari: dariParam,
      sampai: sampaiParam,
    });

    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.errors[0]?.message || "Parameter tidak valid." },
        { status: 400 }
      );
    }

    const { rentang, skala, dari, sampai } = parseResult.data;

    // 2. Validasi kombinasi rentang dan kandidat skala dasar
    const allowedScales = VALID_RENTANG_SKALA[rentang as RentangOption] || [];
    if (!allowedScales.includes(skala as SkalaOption)) {
      return NextResponse.json(
        {
          error: `Kombinasi rentang '${rentang}' dan skala '${skala}' tidak valid. Pilihan skala yang valid untuk rentang ini: ${allowedScales.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    // 3. Validasi skala manual terhadap jumlah slot durasi efektif
    const now = new Date();
    const { start, end } = resolveDateRange(rentang as RentangOption, dari, sampai, now);
    const validScales = getValidScalesForRange(rentang as RentangOption, start, end);

    if (skala !== "otomatis" && !validScales.includes(skala as any)) {
      const slotCount = calculateSlotCount(start, end, skala as any);
      const limitText = slotCount > 96 ? "maks 96" : "min 12";
      const validChoicesText = formatScaleChoices(validScales);
      const scaleLabel = SCALE_LABEL_MAP[skala] || skala;
      return NextResponse.json(
        {
          error: `Skala ${scaleLabel} menghasilkan ${slotCount} slot (${limitText}). Pilih ${validChoicesText}.`,
        },
        { status: 400 }
      );
    }

    // 4. Cek Cache Redis (TTL 45 detik)
    const cacheKey = `cache:timeline:${deviceId}:${rentang}:${skala}:${dari || ""}:${sampai || ""}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(sanitizeForJson(JSON.parse(cached)));
      }
    } catch {
      // Abaikan jika Redis tidak tersedia
    }

    // 5. Hitung timeline dan ringkasan ketersediaan
    const data = await calculateComprehensiveTimeline(
      deviceId,
      rentang as RentangOption,
      skala as SkalaOption,
      dari,
      sampai
    );

    // 6. Validasi batas maksimal 96 slot (batas keras)
    if (data.slots.length > 96) {
      return NextResponse.json(
        {
          error: `Jumlah slot (${data.slots.length}) melebihi batas maksimal (96). Silakan pilih skala lain.`,
        },
        { status: 400 }
      );
    }

    // 7. Simpan ke Cache Redis menggunakan safeJsonStringify
    try {
      await redis.set(cacheKey, safeJsonStringify(data), "EX", 45);
    } catch {
      // Abaikan jika Redis gagal
    }

    return NextResponse.json(sanitizeForJson(data));
  } catch (error: any) {
    const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    const refId = `ERR-TIMELINE-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`;
    console.error(`[GET /riwayat-status] [${refId}] error:`, error?.stack || error);

    if (error?.message === "Perangkat tidak ditemukan.") {
      return NextResponse.json({ error: error.message, ref_id: refId }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "Gagal memproses riwayat status ketersediaan.",
        code: "TIMELINE_INTERNAL_ERROR",
        ref_id: refId,
      },
      { status: 500 }
    );
  }
}
