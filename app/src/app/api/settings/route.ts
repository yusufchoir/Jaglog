import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { settings } from "@shared/schema";
import { redis } from "@shared/redis";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, any> = {};

    for (const s of allSettings) {
      try {
        settingsMap[s.key] = JSON.parse(s.value);
      } catch {
        settingsMap[s.key] = s.value;
      }
    }

    return NextResponse.json({
      settings: settingsMap,
      userRole: session.user.role,
    });
  } catch (err: any) {
    console.error("GET /api/settings Error:", err);
    return NextResponse.json(
      { error: "Gagal memuat pengaturan sistem." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    // Hanya role admin yang boleh mengubah pengaturan
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat mengubah pengaturan sistem." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      log_retention_days,
      ip_allowlist,
      detection_thresholds,
      ai_analysis_hourly_limit,
      ai_provider,
      ai_model,
    } = body;

    const updates: Array<{ key: string; value: string; description?: string }> = [];

    if (log_retention_days !== undefined) {
      updates.push({
        key: "log_retention_days",
        value: String(parseInt(log_retention_days, 10) || 30),
      });
    }

    if (ip_allowlist !== undefined) {
      const arr = Array.isArray(ip_allowlist)
        ? ip_allowlist
        : String(ip_allowlist)
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean);

      updates.push({
        key: "ip_allowlist",
        value: JSON.stringify(arr),
      });
      await redis.del("settings:ip_allowlist");
    }

    if (detection_thresholds !== undefined) {
      updates.push({
        key: "detection_thresholds",
        value: JSON.stringify(detection_thresholds),
      });
      await redis.del("settings:detection_thresholds");
    }

    if (ai_analysis_hourly_limit !== undefined) {
      updates.push({
        key: "ai_analysis_hourly_limit",
        value: String(parseInt(ai_analysis_hourly_limit, 10) || 20),
      });
    }

    if (ai_provider !== undefined) {
      updates.push({
        key: "ai_provider",
        value: String(ai_provider).trim(),
      });
    }

    if (ai_model !== undefined) {
      updates.push({
        key: "ai_model",
        value: String(ai_model).trim(),
      });
    }

    if (body.ai_api_key !== undefined) {
      updates.push({
        key: "ai_api_key",
        value: String(body.ai_api_key).trim(),
      });
    }

    if (body.ai_base_url !== undefined) {
      updates.push({
        key: "ai_base_url",
        value: String(body.ai_base_url).trim(),
      });
    }

    for (const u of updates) {
      await db
        .insert(settings)
        .values({
          key: u.key,
          value: u.value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: u.value,
            updatedAt: new Date(),
          },
        });
    }

    return NextResponse.json({
      success: true,
      message: "Pengaturan sistem berhasil diperbarui.",
    });
  } catch (err: any) {
    console.error("PATCH /api/settings Error:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan perubahan pengaturan." },
      { status: 500 }
    );
  }
}
