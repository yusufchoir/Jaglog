import { NextResponse } from "next/server";
import { queryClient } from "@shared/db";
import { redis } from "@shared/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const healthStatus: {
    status: "ok" | "degraded" | "error";
    postgres: {
      status: "up" | "down";
      latencyMs?: number;
      error?: string;
      usersTableReady?: boolean;
      userCount?: number;
      adminUserSeeded?: boolean;
      schemaReady?: boolean;
      missingTables?: string[];
    };
    redis: { status: "up" | "down"; latencyMs?: number; error?: string };
    timestamp: string;
  } = {

    status: "ok",
    postgres: { status: "down" },
    redis: { status: "down" },
    timestamp: new Date().toISOString(),
  };

  // 1. Check Postgres
  const pgStart = Date.now();
  try {
    await queryClient`SELECT 1;`;
    let userCount: number | null = null;
    let adminExists = false;

    try {
      const usersList = await queryClient`SELECT username, role, is_active FROM users;`;
      userCount = usersList.length;
      adminExists = usersList.some((u: any) => u.username === (process.env.ADMIN_USERNAME || "admin"));

      // Jika tabel users ada tapi masih kosong, jalankan seed otomatis
      if (userCount === 0) {
        try {
          const { seed } = await import("@shared/seed");
          await seed();
          const refreshed = await queryClient`SELECT username FROM users;`;
          userCount = refreshed.length;
          adminExists = refreshed.some((u: any) => u.username === (process.env.ADMIN_USERNAME || "admin"));
        } catch (seedErr) {
          console.warn("[Health] Auto-seed failed:", seedErr);
        }
      }
    } catch (tblErr: any) {
      console.warn("[Health] Table users check:", tblErr.message);
    }

    // Verifikasi skema esensial (14 tabel wajib)
    const essentialTables = [
      "devices",
      "device_groups",
      "device_status_history",
      "device_ping_hourly",
      "device_log_hourly",
      "incidents",
      "log_events",
      "ai_analyses",
      "topology_maps",
      "topology_nodes",
      "topology_links",
      "client_errors",
      "settings",
      "users",
    ];

    let missingTables: string[] = [];
    try {
      const dbTables = await queryClient`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
      `;
      const tableSet = new Set(dbTables.map((r: any) => r.table_name));
      missingTables = essentialTables.filter((tbl) => !tableSet.has(tbl));

      // Verifikasi kolom kritis
      const dbColumns = await queryClient`
        SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public';
      `;
      const colSet = new Set(dbColumns.map((c: any) => `${c.table_name}.${c.column_name}`));
      const criticalCols = [
        "devices.id", "devices.name", "devices.is_active", "devices.status",
        "device_log_hourly.hour_bucket", "device_log_hourly.received_count",
        "device_ping_hourly.hour_bucket", "device_ping_hourly.check_count",
        "client_errors.sidik_jari",
      ];
      const missingCols = criticalCols.filter((col) => !colSet.has(col));
      if (missingCols.length > 0) {
        missingTables.push(...missingCols.map((c) => `column:${c}`));
      }
    } catch (scErr: any) {
      console.warn("[Health] Schema validation query failed:", scErr.message);
      missingTables = ["*"];
    }

    const schemaReady = missingTables.length === 0;
    if (!schemaReady) {
      healthStatus.status = "error";
      console.error("[Health] Database schema mismatch! Missing tables/columns:", missingTables);
    }

    healthStatus.postgres = {
      status: "up",
      latencyMs: Date.now() - pgStart,
      usersTableReady: userCount !== null,
      userCount: userCount ?? 0,
      adminUserSeeded: adminExists,
      schemaReady,
      missingTables: missingTables.length > 0 ? missingTables : undefined,
    };
  } catch (error) {
    healthStatus.status = "degraded";
    healthStatus.postgres = {
      status: "down",
      error: error instanceof Error ? error.message : "Gagal terhubung ke database",
    };
  }


  // 2. Check Redis
  const redisStart = Date.now();
  try {
    const pingResult = await redis.ping();
    if (pingResult === "PONG") {
      healthStatus.redis = {
        status: "up",
        latencyMs: Date.now() - redisStart,
      };
    } else {
      throw new Error(`Unexpected Redis response: ${pingResult}`);
    }
  } catch (error) {
    healthStatus.status = "degraded";
    healthStatus.redis = {
      status: "down",
      error: error instanceof Error ? error.message : "Gagal terhubung ke Redis",
    };
  }

  if (healthStatus.postgres.status === "down" && healthStatus.redis.status === "down") {
    healthStatus.status = "error";
  }

  const statusCode = healthStatus.status === "ok" ? 200 : 503;
  return NextResponse.json(healthStatus, { status: statusCode });
}
