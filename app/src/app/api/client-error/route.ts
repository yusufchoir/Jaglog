import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { clientErrors } from "@shared/schema";
import { redis } from "@shared/redis";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const clientErrorSchema = z.object({
  nama: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  pesan: z.string().max(2000).optional(),
  message: z.string().max(2000).optional(),
  stack: z.string().max(4096).optional().nullable(),
  path: z.string().max(255).default("/"),
  build: z.string().max(50).optional().nullable(),
  buildId: z.string().max(50).optional().nullable(),
  komponen: z.string().max(100).optional().nullable(),
  component: z.string().max(100).optional().nullable(),
  errorId: z.string().max(50).optional().nullable(),
  tipe: z.string().max(50).optional().nullable(),
  type: z.string().max(50).optional().nullable(),
  waktu: z.string().optional().nullable(),
});

function sanitizeContent(str: string): string {
  if (!str) return "";
  return str
    .replace(/(bearer\s+[a-zA-Z0-9_\-\.]+)/gi, "bearer [TERLINDUNGI]")
    .replace(/(password|token|secret|cookie|auth)=([^&\s]+)/gi, "$1=[TERLINDUNGI]")
    .replace(/("password"|"token"|"secret"|"cookie")\s*:\s*"[^"]+"/gi, '$1:"[TERLINDUNGI]"')
    .slice(0, 4096);
}

// POST /api/client-error — Menerima laporan kesalahan sisi klien
export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "unknown";

    // Rate limiting via Redis: Maks 20 laporan per menit per IP
    const rateLimitKey = `ratelimit:client_error:${ip}`;
    try {
      const currentCount = await redis.incr(rateLimitKey);
      if (currentCount === 1) {
        await redis.expire(rateLimitKey, 60);
      }
      if (currentCount > 20) {
        return NextResponse.json(
          { error: "Batas pengiriman laporan kesalahan terlampaui. Coba lagi nanti." },
          { status: 429 }
        );
      }
    } catch {
      // Abaikan jika Redis offline
    }

    const session = await getCurrentSession();
    const userId = session?.user?.userId || null;

    const rawBody = await request.json().catch(() => null);
    const parsed = clientErrorSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload laporan kesalahan tidak valid." },
        { status: 400 }
      );
    }

    const finalNama = (parsed.data.nama || parsed.data.name || "Error").slice(0, 100);
    const finalPesan = (parsed.data.pesan || parsed.data.message || "Unknown error").slice(0, 2000);
    const finalStack = parsed.data.stack;
    const rawPath = parsed.data.path || "/";
    const finalBuild = parsed.data.build || parsed.data.buildId || "1.0.0";
    const finalKomponen = parsed.data.komponen || parsed.data.component || null;
    const finalTipe = parsed.data.tipe || parsed.data.type || "boundary";

    // Bersihkan path dari parameter query sensitif
    let cleanPath = rawPath.split("?")[0].slice(0, 255);
    if (!cleanPath.startsWith("/")) cleanPath = "/" + cleanPath;

    const cleanPesan = sanitizeContent(finalPesan).slice(0, 2000);
    const cleanStack = finalStack ? sanitizeContent(finalStack).slice(0, 4096) : null;
    const cleanKomponen = finalKomponen ? sanitizeContent(finalKomponen).slice(0, 100) : null;
    const cleanBuild = finalBuild.slice(0, 50);

    // Buat sidik jari SHA-256 unik untuk deduplikasi / upsert
    const fingerprintRaw = `${finalNama.trim()}:${cleanPesan.trim()}:${cleanPath}:${cleanKomponen || ""}`;
    const sidikJari = crypto.createHash("sha256").update(fingerprintRaw).digest("hex");

    const now = new Date();

    // Upsert ke tabel client_errors dengan penanganan kegagalan database non-fatal
    try {
      await db
        .insert(clientErrors)
        .values({
          userId,
          path: cleanPath,
          pesan: `${finalNama}: ${cleanPesan}`,
          stack: cleanStack,
          build: cleanBuild,
          userAgent: sanitizeContent(userAgent).slice(0, 500),
          sidikJari,
          jumlah: 1,
          terakhirTerjadi: now,
          komponen: cleanKomponen,
          status: "baru",
        })
        .onConflictDoUpdate({
          target: clientErrors.sidikJari,
          set: {
            jumlah: sql`${clientErrors.jumlah} + 1`,
            terakhirTerjadi: now,
            status: "baru",
            stack: cleanStack,
            userAgent: sanitizeContent(userAgent).slice(0, 500),
          },
        });
    } catch (dbErr: any) {
      console.warn("[POST /api/client-error] Penulisan ke database gagal (non-fatal):", dbErr?.message || dbErr);
      // Tetap kembalikan 202 Accepted agar klien logger tidak melempar error baru
      return NextResponse.json(
        { success: false, message: "Laporan kesalahan dicatat di server log.", sidikJari },
        { status: 202 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Laporan kesalahan klien berhasil dicatat.",
      sidikJari,
    });
  } catch (err: any) {
    console.error("[POST /api/client-error] Kesalahan tak terduga:", err?.stack || err);
    // Tidak pernah kembalikan 500 ke klien pelapor error
    return NextResponse.json(
      { success: false, message: "Laporan kesalahan diterima secara darurat." },
      { status: 202 }
    );
  }
}

// GET /api/client-error — Mengambil daftar kesalahan klien terbaru (Khusus Admin)
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat melihat laporan kesalahan." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const statusFilter = searchParams.get("status"); // 'baru' | 'selesai' | 'semua'

    let query = db
      .select()
      .from(clientErrors)
      .$dynamic();

    if (statusFilter && statusFilter !== "semua") {
      query = query.where(eq(clientErrors.status, statusFilter));
    }

    const errors = await query
      .orderBy(desc(clientErrors.terakhirTerjadi))
      .limit(limit);

    return NextResponse.json({
      success: true,
      errors,
    });
  } catch (err: any) {
    console.error("GET /api/client-error error:", err);
    return NextResponse.json(
      { error: "Gagal memuat laporan kesalahan." },
      { status: 500 }
    );
  }
}

// PATCH /api/client-error — Menandai kesalahan selesai (Khusus Admin)
export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat memperbarui status kesalahan." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "ID kesalahan wajib diisi." }, { status: 400 });
    }

    await db
      .update(clientErrors)
      .set({
        status: body.status === "baru" ? "baru" : "selesai",
      })
      .where(eq(clientErrors.id, body.id));

    return NextResponse.json({
      success: true,
      message: "Status kesalahan berhasil diperbarui.",
    });
  } catch (err: any) {
    console.error("PATCH /api/client-error error:", err);
    return NextResponse.json(
      { error: "Gagal memperbarui status kesalahan." },
      { status: 500 }
    );
  }
}
