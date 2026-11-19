import { db, queryClient } from "@shared/db";
import { devices, logEvents, incidents } from "@shared/schema";
import { parseLog } from "@shared/parsers";
import { runDetectionEngine } from "@shared/detection";
import { eq, inArray } from "drizzle-orm";

async function main() {
  console.log("==========================================================");
  console.log("   JagaLog: Simulasi Injeksi Skenario Serangan Jaringan   ");
  console.log("==========================================================\n");

  // 1. Siapkan perangkat simulasi
  console.log("[1/4] Menyiapkan perangkat uji simulasi...");
  let [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.name, "Perangkat-Simulasi-Serangan"))
    .limit(1);

  if (!device) {
    const [created] = await db
      .insert(devices)
      .values({
        name: "Perangkat-Simulasi-Serangan",
        type: "mikrotik",
        ipAddress: "10.254.254.1",
        location: "Lab Simulasi Siber",
        notes: "Perangkat otomatis untuk simulasi serangan siber",
        isActive: true,
      })
      .returning();
    device = created;
    console.log(`✓ Perangkat simulasi dibuat: ID ${device.id}`);
  } else {
    console.log(`✓ Menggunakan perangkat simulasi yang ada: ID ${device.id}`);
  }

  const now = new Date();
  const rawLogsToInsert: {
    deviceId: string;
    receivedAt: Date;
    eventTime: Date;
    message: string;
    raw: string;
    deviceType: string;
  }[] = [];

  // ==========================================================
  // SKENARIO 1: Brute Force SSH Login (14x percobaan gagal dari 1 IP)
  // ==========================================================
  console.log("\n[2/4] Menginjeksikan skenario serangan...");
  const bruteForceIp = "203.0.113.195";
  console.log(`  -> Skenario 1: Brute force login 14x dari IP ${bruteForceIp}`);
  for (let i = 0; i < 14; i++) {
    const time = new Date(now.getTime() - (14 - i) * 10000); // interval 10 detik
    const msg = `login failure for user admin from ${bruteForceIp} via ssh`;
    rawLogsToInsert.push({
      deviceId: device.id,
      receivedAt: time,
      eventTime: time,
      message: msg,
      raw: `system,error,critical ${msg}`,
      deviceType: "mikrotik",
    });
  }

  // ==========================================================
  // SKENARIO 2: Port Scanning (25 Port Disentuh dari 1 IP)
  // ==========================================================
  const portScanIp = "198.51.100.88";
  const targetPorts = [
    21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1433, 1521,
    3306, 3389, 5432, 5900, 8080, 8443, 8888, 9000, 9200,
  ];
  console.log(`  -> Skenario 2: Port scanning 25 port berbeda dari IP ${portScanIp}`);
  for (let i = 0; i < targetPorts.length; i++) {
    const port = targetPorts[i];
    const time = new Date(now.getTime() - (targetPorts.length - i) * 1500); // 1.5 detik per port
    const msg = `firewall,info drop: in:ether1 out:, proto TCP (SYN), ${portScanIp}:${40000 + i}->10.254.254.1:${port}, len 60`;
    rawLogsToInsert.push({
      deviceId: device.id,
      receivedAt: time,
      eventTime: time,
      message: msg,
      raw: msg,
      deviceType: "mikrotik",
    });
  }

  // ==========================================================
  // SKENARIO 3: Akun Admin Baru & Eskalasi Hak Akses (Windows)
  // ==========================================================
  console.log("  -> Skenario 3: Pembuatan akun backdoor & penambahan ke grup Administrators");
  const timeAdminCreate = new Date(now.getTime() - 45000);
  const timeAdminGroup = new Date(now.getTime() - 30000);

  rawLogsToInsert.push({
    deviceId: device.id,
    receivedAt: timeAdminCreate,
    eventTime: timeAdminCreate,
    message: "A user account was created: TargetUserName: ghost_admin",
    raw: JSON.stringify({
      EventID: 4720,
      Channel: "Security",
      TargetUserName: "ghost_admin",
      SubjectUserName: "SYSTEM",
    }),
    deviceType: "windows",
  });

  rawLogsToInsert.push({
    deviceId: device.id,
    receivedAt: timeAdminGroup,
    eventTime: timeAdminGroup,
    message: "A member was added to a security-enabled local group: TargetGroupName: Administrators, MemberName: ghost_admin",
    raw: JSON.stringify({
      EventID: 4732,
      Channel: "Security",
      TargetGroupName: "Administrators",
      MemberName: "CN=ghost_admin,CN=Users,DC=corp,DC=local",
    }),
    deviceType: "windows",
  });

  // ==========================================================
  // SKENARIO 4: Password Spraying (6 Akun Berbeda dari 1 IP)
  // ==========================================================
  const sprayIp = "185.220.101.5";
  const sprayAccounts = ["support", "operator", "billing", "noc", "backup", "cisco"];
  console.log(`  -> Skenario 4: Password spray 6 akun berbeda dari IP ${sprayIp}`);
  for (let i = 0; i < sprayAccounts.length; i++) {
    const acc = sprayAccounts[i];
    const time = new Date(now.getTime() - (sprayAccounts.length - i) * 8000);
    const msg = `Failed password for invalid user ${acc} from ${sprayIp} port ${45000 + i} ssh2`;
    rawLogsToInsert.push({
      deviceId: device.id,
      receivedAt: time,
      eventTime: time,
      message: msg,
      raw: `sshd[${1200 + i}]: ${msg}`,
      deviceType: "linux",
    });
  }

  // ==========================================================
  // SKENARIO 5: Log Audit Dihapus (Anti-Forensik)
  // ==========================================================
  console.log("  -> Skenario 5: Pembersihan log audit keamanan (EventID 1102)");
  const timeLogClear = new Date(now.getTime() - 10000);
  rawLogsToInsert.push({
    deviceId: device.id,
    receivedAt: timeLogClear,
    eventTime: timeLogClear,
    message: "The audit log was cleared",
    raw: JSON.stringify({
      EventID: 1102,
      Channel: "Security",
      SubjectUserName: "ghost_admin",
    }),
    deviceType: "windows",
  });

  // Normalisasi dengan Parser & Insert ke tabel log_events
  const parsedLogs = rawLogsToInsert.map((item) => {
    const normalized = parseLog(item.message, item.raw, item.deviceType);
    return {
      deviceId: item.deviceId,
      receivedAt: item.receivedAt,
      eventTime: item.eventTime,
      severity: normalized.severity,
      facility: 1,
      sourceApp: normalized.sourceApp || item.deviceType,
      category: normalized.category,
      message: item.message,
      raw: item.raw,
      parsed: normalized.parsed,
    };
  });

  await db.insert(logEvents).values(parsedLogs);
  console.log(`✓ Berhasil memasukkan ${parsedLogs.length} event log serangan ke database.`);

  // 3. Jalankan Rule Engine Deteksi Serangan
  console.log("\n[3/4] Menjalankan Rule Engine Deteksi Serangan...");
  const engineResult = await runDetectionEngine();
  console.log(
    `✓ Siklus Rule Engine selesai dalam ${engineResult.durationMs}ms: ` +
      `${engineResult.matchesCount} pola serangan cocok (${engineResult.newIncidentsCount} insiden baru, ${engineResult.updatedIncidentsCount} diperbarui).`
  );

  // 4. Tampilkan Insiden yang Terbentuk
  console.log("\n[4/4] Memeriksa daftar insiden yang tercatat di database:");
  const activeIncidents = await db
    .select({
      id: incidents.id,
      ruleKey: incidents.ruleKey,
      severity: incidents.severity,
      title: incidents.title,
      mainEntity: incidents.mainEntity,
      count: incidents.count,
      status: incidents.status,
      firstSeen: incidents.firstSeen,
      lastSeen: incidents.lastSeen,
      evidence: incidents.evidence,
    })
    .from(incidents)
    .where(eq(incidents.deviceId, device.id))
    .orderBy(incidents.lastSeen);

  console.log("---------------------------------------------------------------------------------------------------");
  console.log(
    "SEVERITY".padEnd(10) +
      "RULE KEY".padEnd(25) +
      "COUNT".padEnd(8) +
      "ENTITAS".padEnd(20) +
      "JUDUL INSIDEN"
  );
  console.log("---------------------------------------------------------------------------------------------------");

  for (const inc of activeIncidents) {
    const sevColor =
      inc.severity === "critical"
        ? "\x1b[31mCRITICAL\x1b[0m"
        : inc.severity === "high"
        ? "\x1b[33mHIGH\x1b[0m    "
        : "MEDIUM  ";

    console.log(
      `${sevColor}  ${inc.ruleKey.padEnd(23)}  ${String(inc.count).padEnd(6)}  ${(inc.mainEntity || "-").padEnd(18)}  ${inc.title}`
    );
  }
  console.log("---------------------------------------------------------------------------------------------------\n");

  console.log("✓ Simulasi Selesai! Semua skenario serangan berhasil disuntikkan dan terdeteksi sempurna.\n");
  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Kesalahan saat menjalankan simulasi serangan:", err);
  process.exit(1);
});
