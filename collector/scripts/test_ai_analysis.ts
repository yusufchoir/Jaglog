import { db, queryClient } from "@shared/db";
import { incidents, devices } from "@shared/schema";
import { analyzeIncident } from "@shared/ai";
import { eq, desc } from "drizzle-orm";

async function main() {
  console.log("==========================================================");
  console.log("   JagaLog: Uji Coba Analisa Keamanan Siber Berbasis AI   ");
  console.log("==========================================================\n");

  console.log("[1/3] Mencari insiden keamanan aktif di database...");

  // Cari insiden brute force atau insiden dengan severity high/critical
  let [incident] = await db
    .select({
      id: incidents.id,
      title: incidents.title,
      ruleKey: incidents.ruleKey,
      severity: incidents.severity,
      mainEntity: incidents.mainEntity,
      deviceId: incidents.deviceId,
      count: incidents.count,
    })
    .from(incidents)
    .where(eq(incidents.ruleKey, "brute_force_login"))
    .orderBy(desc(incidents.lastSeen))
    .limit(1);

  if (!incident) {
    // Cari insiden apapun jika brute force belum ada
    const [anyIncident] = await db
      .select({
        id: incidents.id,
        title: incidents.title,
        ruleKey: incidents.ruleKey,
        severity: incidents.severity,
        mainEntity: incidents.mainEntity,
        deviceId: incidents.deviceId,
        count: incidents.count,
      })
      .from(incidents)
      .limit(1);

    incident = anyIncident;
  }

  if (!incident) {
    console.error("Tidak ditemukan insiden di database. Jalankan simulasi serangan terlebih dahulu!");
    process.exit(1);
  }

  const [device] = await db
    .select({ name: devices.name, type: devices.type })
    .from(devices)
    .where(eq(devices.id, incident.deviceId))
    .limit(1);

  console.log(`✓ Menemukan Insiden: "${incident.title}"`);
  console.log(`  - ID Insiden  : ${incident.id}`);
  console.log(`  - Rule Key    : ${incident.ruleKey}`);
  console.log(`  - Severity    : ${incident.severity}`);
  console.log(`  - Perangkat   : ${device?.name || "-"} (${device?.type || "-"})`);
  console.log(`  - Entitas IP  : ${incident.mainEntity || "-"}`);
  console.log(`  - Jumlah Kejadian: ${incident.count} kali\n`);

  console.log("[2/3] Mengirimkan data teragregasi & termasker ke Modul Analisa AI...");
  const startTime = Date.now();
  const result = await analyzeIncident(incident.id, true); // Force analysis
  const duration = Date.now() - startTime;

  if (!result.success || !result.data) {
    console.error(`✗ Analisa AI gagal: ${result.error}`);
    process.exit(1);
  }

  console.log(`✓ Analisa AI berhasil diproses dalam ${duration}ms! Model: ${result.data.model}\n`);

  console.log("[3/3] HASIL KELUARAN JSON ANALISA KEAMANAN:");
  console.log("--------------------------------------------------------------------------------");
  const formattedJson = {
    risk_level: result.data.riskLevel,
    confidence: result.data.confidence,
    suspected_attack: result.data.suspectedAttack,
    summary: result.data.summary,
    findings: result.data.findings,
    recommendations: result.data.recommendations,
  };

  console.log(JSON.stringify(formattedJson, null, 2));
  console.log("--------------------------------------------------------------------------------\n");

  console.log("✓ Selesai! Analisa AI tervalidasi skema Zod dan tersimpan di database `ai_analyses`.");
  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Kesalahan pengujian:", err);
  process.exit(1);
});
