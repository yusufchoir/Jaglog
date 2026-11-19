import { db } from "../db";
import { aiAnalyses, settings } from "../schema";
import { redis } from "../redis";
import { eq, desc } from "drizzle-orm";
import { getActiveAIProvider } from "./provider";
import { SECURITY_ANALYST_SYSTEM_PROMPT } from "./system-prompt";
import { buildIncidentContext, buildDeviceDailyContext } from "./aggregator";
import { aiAnalysisOutputSchema, AIAnalysisOutput } from "./types";
import { publishChange } from "../events/publisher";

const HOURLY_RATE_LIMIT_KEY = "ratelimit:ai:calls:hourly";
const ANALYSIS_CACHE_TTL = 3600; // 1 Jam

/**
 * Memeriksa batas panggilan AI per jam
 */
async function checkHourlyRateLimit(): Promise<boolean> {
  try {
    const [settingRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "ai_analysis_hourly_limit"))
      .limit(1);

    const limit = parseInt(settingRow?.value || "20", 10);

    const currentCount = await redis.incr(HOURLY_RATE_LIMIT_KEY);
    if (currentCount === 1) {
      await redis.expire(HOURLY_RATE_LIMIT_KEY, 3600);
    }

    return currentCount <= limit;
  } catch {
    return true; // Jika redis error, tetap izinkan agar tidak memblokir sistem
  }
}

/**
 * Memanggil AI Provider dengan validasi Zod dan 1x percobaan ulang jika JSON tidak valid
 */
async function callAIWithValidation(
  systemPrompt: string,
  userPrompt: string
): Promise<{ output: AIAnalysisOutput; modelName: string }> {
  const provider = getActiveAIProvider();
  let rawResponse = await provider.generateText(systemPrompt, userPrompt);

  // Parsing JSON & Validasi Zod percobaan ke-1
  try {
    const parsed = JSON.parse(extractJsonString(rawResponse));
    const validated = aiAnalysisOutputSchema.parse(parsed);
    return { output: validated, modelName: provider.name };
  } catch (errFirst) {
    // Percobaan ulang ke-2 dengan instruksi perbaikan eksplisit
    const retryPrompt = `${userPrompt}\n\n[PERBAIKAN]: Respons sebelumnya tidak valid JSON atau tidak sesuai skema Zod (${errFirst}). Mohon hasilkan HANYA JSON valid sesuai skema yang diminta tanpa markdown formatting.`;
    rawResponse = await provider.generateText(systemPrompt, retryPrompt);

    const parsedSecond = JSON.parse(extractJsonString(rawResponse));
    const validatedSecond = aiAnalysisOutputSchema.parse(parsedSecond);
    return { output: validatedSecond, modelName: provider.name };
  }
}

function extractJsonString(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```\s*$/, "");
  }
  return cleaned.trim();
}

/**
 * 1. Analisa Insiden (Manual via tombol UI atau otomatis saat insiden >= high)
 */
export async function analyzeIncident(
  incidentId: string,
  force = false
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const context = await buildIncidentContext(incidentId);
    if (!context) {
      return { success: false, error: "Insiden atau perangkat terkait tidak ditemukan." };
    }

    const cacheKey = `ai:cache:incident:${incidentId}:${context.incident.count}`;

    // Cek cache Redis (jika tidak dipaksa re-analisa)
    if (!force) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached) };
      }
    }

    // Cek batasan panggilan AI per jam
    const isAllowed = await checkHourlyRateLimit();
    if (!isAllowed) {
      return {
        success: false,
        error: "Batas panggilan analisa AI per jam telah tercapai. Coba lagi beberapa saat lagi.",
      };
    }

    // Pasang lock terdistribusi di Redis untuk mencegah eksekusi paralel ganda
    const lockKey = `ai:lock:incident:${incidentId}`;
    const acquired = await redis.set(lockKey, "1", "EX", 60, "NX");
    if (!acquired) {
      return {
        success: false,
        error: "Analisa AI untuk insiden ini sedang berjalan. Harap tunggu beberapa saat.",
      };
    }

    try {
      const userPrompt = `
Lakukan analisis keamanan terhadap insiden berikut:
DATA PERANGKAT:
- Nama: ${context.device.name}
- Tipe Perangkat: ${context.device.type}
- IP Perangkat: ${context.device.ipAddress || "-"}
- Lokasi: ${context.device.location || "-"}

DATA INSIDEN:
- Judul Insiden: ${context.incident.title}
- Aturan Deteksi (Rule Key): ${context.incident.ruleKey}
- Tingkat Keparahan (Severity): ${context.incident.severity}
- Entitas Utama: ${context.incident.mainEntity || "-"}
- Frekuensi Kejadian: ${context.incident.count} kali
- Rentang Waktu: ${context.incident.firstSeen} s/d ${context.incident.lastSeen}

CONTOH SAMPEL EVENT LOG TERKAIT (${context.sampleLogs.length} event):
${JSON.stringify(context.sampleLogs, null, 2)}
`.trim();

      const { output, modelName } = await callAIWithValidation(
        SECURITY_ANALYST_SYSTEM_PROMPT,
        userPrompt
      );

      // Simpan hasil analisa ke tabel ai_analyses
      const [saved] = await db
        .insert(aiAnalyses)
        .values({
          deviceId: context.device.id,
          incidentId: context.incident.id,
          riskLevel: output.risk_level,
          summary: output.summary,
          suspectedAttack: output.suspected_attack,
          recommendations: output.recommendations,
          confidence: output.confidence,
          findings: output.findings,
          model: modelName,
        })
        .returning();

      publishChange({
        tipe: "analisa.selesai",
        perangkat_id: context.device.id,
        data_ringkas: { id_insiden: context.incident.id },
      }).catch(() => {});

      // Simpan ke cache Redis
      await redis.set(cacheKey, JSON.stringify(saved), "EX", ANALYSIS_CACHE_TTL);

      return { success: true, data: saved };
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
  } catch (error: any) {
    console.error(`[AI Analysis Service Error] Insiden ${incidentId}:`, error);
    return {
      success: false,
      error: "Analisa AI belum tersedia saat ini. Silakan periksa kembali konfigurasi API Key atau coba beberapa saat lagi.",
    };
  }
}

/**
 * 2. Analisa Ringkasan Harian Per Perangkat (24 jam terakhir)
 */
export async function analyzeDeviceDaily(
  deviceId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const context = await buildDeviceDailyContext(deviceId);
    if (!context) {
      return { success: false, error: "Tidak ada aktivitas log dalam 24 jam terakhir pada perangkat ini." };
    }

    const cacheKey = `ai:cache:daily:${deviceId}:${context.period.start.slice(0, 10)}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return { success: true, data: JSON.parse(cached) };
    }

    const isAllowed = await checkHourlyRateLimit();
    if (!isAllowed) {
      return { success: false, error: "Batas panggilan analisa AI per jam telah tercapai." };
    }

    const userPrompt = `
Lakukan tinjauan ringkasan keamanan harian (24 jam terakhir) untuk perangkat jaringan:
PERANGKAT:
- Nama: ${context.device.name}
- Tipe: ${context.device.type}
- IP: ${context.device.ipAddress || "-"}

STATISTIK 24 JAM:
- Total Log: ${context.stats.totalLogs}
- Distribusi Severity: ${JSON.stringify(context.stats.severityDistribution)}
- Distribusi Kategori: ${JSON.stringify(context.stats.categoryDistribution)}
- Top Source IPs: ${JSON.stringify(context.stats.topSourceIps)}
- Top Akun: ${JSON.stringify(context.stats.topAccounts)}

DAFTAR INSIDEN AKTIF DALAM 24 JAM:
${JSON.stringify(context.activeIncidents, null, 2)}

SAMPEL LOG TERPILIH:
${JSON.stringify(context.sampleLogs, null, 2)}
`.trim();

    const { output, modelName } = await callAIWithValidation(
      SECURITY_ANALYST_SYSTEM_PROMPT,
      userPrompt
    );

    const [saved] = await db
      .insert(aiAnalyses)
      .values({
        deviceId: context.device.id,
        periodStart: new Date(context.period.start),
        periodEnd: new Date(context.period.end),
        riskLevel: output.risk_level,
        summary: output.summary,
        suspectedAttack: output.suspected_attack,
        recommendations: output.recommendations,
        confidence: output.confidence,
        findings: output.findings,
        model: modelName,
      })
      .returning();

    publishChange({
      tipe: "analisa.selesai",
      perangkat_id: context.device.id,
    }).catch(() => {});

    await redis.set(cacheKey, JSON.stringify(saved), "EX", ANALYSIS_CACHE_TTL);
    return { success: true, data: saved };
  } catch (error: any) {
    console.error(`[AI Daily Summary Error] Perangkat ${deviceId}:`, error);
    return {
      success: false,
      error: "Analisa AI belum tersedia saat ini.",
    };
  }
}
