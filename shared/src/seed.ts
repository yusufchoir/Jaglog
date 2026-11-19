import { hash } from "@node-rs/argon2";
import { db, queryClient } from "./db";
import { users, settings } from "./schema";
import { count } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config();

export async function seed() {
  console.log("Checking database users for initial seed...");

  const [userCountResult] = await db.select({ value: count() }).from(users);
  const userCount = Number(userCountResult?.value ?? 0);

  if (userCount === 0) {
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "JagaLogAdmin123!";

    console.log(`No users found. Creating initial admin user: ${adminUsername}`);
    const passwordHash = await hash(adminPassword);

    await db.insert(users).values({
      username: adminUsername,
      passwordHash,
      role: "admin",
      isActive: true,
      mustChangePassword: true,
    });
    console.log("Initial admin user created successfully with mustChangePassword = true.");
  } else {
    console.log(`Database already has ${userCount} user(s). Skipping user seed.`);
  }

  // Seed default settings if not exists
  const defaultSettings = [
    {
      key: "log_retention_days",
      value: process.env.LOG_RETENTION_DAYS || "30",
      description: "Jumlah hari penyimpanan event log sebelum dihapus otomatis",
    },
    {
      key: "ip_allowlist",
      value: JSON.stringify(["127.0.0.1", "::1"]),
      description: "Daftar IP yang dikecualikan dari deteksi serangan (JSON array)",
    },
    {
      key: "detection_thresholds",
      value: JSON.stringify({
        brute_force_login: { max_failures: 10, window_minutes: 5 },
        password_spray: { max_users: 5, window_minutes: 10 },
        success_after_failures: { min_failures: 5 },
        port_scan: { min_ports: 20, window_minutes: 1 },
        device_silent_minutes: 15,
        log_burst_multiplier: 5,
      }),
      description: "Ambang batas aturan deteksi serangan",
    },
    {
      key: "ai_analysis_hourly_limit",
      value: "20",
      description: "Maksimal pemanggilan analisa AI per jam",
    },
  ];

  for (const s of defaultSettings) {
    await db
      .insert(settings)
      .values(s)
      .onConflictDoNothing({ target: settings.key });
  }

  console.log("Default system settings seeded successfully.");
}

if (require.main === module || process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(async () => {
      await queryClient.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Seed error:", err);
      await queryClient.end();
      process.exit(1);
    });
}
