import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logFilters } from "@shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { publishFilterInvalidate } from "@shared/log-filter";

export const dynamic = "force-dynamic";

const DANGEROUS_REGEX_PATTERNS = [
  /\([^)]*(\+|\*)\)[+*]/i, // Nested repetition quantifier: (a+)+, (a*)+, ([0-9]+)+
  /\(.*\|.*\)[+*]/i,        // Grouped alternation repetition: (a|b)+
];

function validatePattern(matchType: string, pattern: string): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim().length === 0) {
    return { valid: false, error: "Pola filter tidak boleh kosong." };
  }

  if (pattern.length > 500) {
    return { valid: false, error: "Panjang pola tidak boleh melebihi 500 karakter." };
  }

  if (matchType === "regex") {
    // Cek pola rentan ReDoS sederhana
    for (const dangerous of DANGEROUS_REGEX_PATTERNS) {
      if (dangerous.test(pattern)) {
        return {
          valid: false,
          error: "Pola regex berpotensi rentan terhadap ReDoS (nested repetition). Gunakan pola yang lebih spesifik.",
        };
      }
    }

    try {
      new RegExp(pattern);
    } catch (err: any) {
      return { valid: false, error: `Sintaks regex tidak valid: ${err?.message || ""}` };
    }
  }

  return { valid: true };
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("deviceId");
    const scope = searchParams.get("scope"); // 'all' | 'device' | 'global'

    let conditions: any[] = [];

    if (scope === "global" || deviceId === "global") {
      conditions.push(isNull(logFilters.deviceId));
    } else if (deviceId) {
      if (scope === "all") {
        // Gabungkan filter perangkat dan filter global
        // Handled via separate queries or OR condition
      } else {
        conditions.push(eq(logFilters.deviceId, deviceId));
      }
    }

    const filters = await db
      .select()
      .from(logFilters)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(logFilters.createdAt));

    return NextResponse.json({ filters });
  } catch (err: any) {
    console.error("GET /api/filters Error:", err);
    return NextResponse.json({ error: "Gagal memuat daftar filter log." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat mengelola filter log." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { deviceId, name, matchType, pattern, action, isActive = true, description } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: "Nama filter wajib diisi." }, { status: 400 });
    }

    const validActions = ["discard", "merge", "lower_severity"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Aksi filter tidak valid (pilih: buang, gabung, turunkan_severity)." }, { status: 400 });
    }

    const validTypes = ["contains", "exact", "regex"];
    if (!validTypes.includes(matchType)) {
      return NextResponse.json({ error: "Tipe pencocokan tidak valid (pilih: mengandung, persis, regex)." }, { status: 400 });
    }

    const validation = validatePattern(matchType, pattern);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const [created] = await db
      .insert(logFilters)
      .values({
        deviceId: deviceId || null,
        name: name.trim(),
        matchType,
        pattern: pattern.trim(),
        action,
        isActive: Boolean(isActive),
        description: description ? description.trim() : null,
        createdBy: session.user.username,
        isSystemSuggested: false,
      })
      .returning();

    // Catat audit log
    console.log(
      `[AUDIT] [${new Date().toISOString()}] Admin '${session.user.username}' created log filter '${created.name}' (${created.id}) - pattern: '${created.pattern}', action: '${created.action}'`
    );

    // Invalidasi cache di semua worker
    await publishFilterInvalidate();

    return NextResponse.json({
      message: "Aturan filter log berhasil dibuat.",
      filter: created,
    });
  } catch (err: any) {
    console.error("POST /api/filters Error:", err);
    return NextResponse.json({ error: "Gagal membuat aturan filter log." }, { status: 500 });
  }
}
