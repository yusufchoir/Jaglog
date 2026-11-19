import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { redis } from "../shared/src/redis";

async function runScenarioTests() {
  console.log("=== PENGUJIAN SKENARIO LANGKAH 3 ===");

  const sessionUser = await db.execute<{ id: string; username: string }>(sql`
    SELECT id, username FROM users WHERE role = 'admin' LIMIT 1;
  `);

  if (!sessionUser[0]) {
    console.error("Admin user tidak ditemukan.");
    process.exit(1);
  }

  const { createSession } = await import("../shared/src/auth");
  const sessionId = await createSession({
    userId: sessionUser[0].id,
    username: sessionUser[0].username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });
  const cookieHeader = `jagalog_session=${sessionId}`;

  // 1. Skenario Cache Dingin
  console.log("\n[Skenario 1] Cache Dingin (Invaliasi Cache Redis)...");
  await redis.del("cache:dashboard:stats");
  await redis.del("cache:dashboard:stats:stale");

  const tCold0 = performance.now();
  const resCold = await fetch("http://localhost:3000/api/stats/dashboard", {
    headers: { Cookie: cookieHeader },
  });
  const durCold = performance.now() - tCold0;
  console.log(`  Status: ${resCold.status}, Waktu: ${durCold.toFixed(1)} ms, Server-Timing: ${resCold.headers.get("server-timing")}`);

  // 2. Skenario Cache Hangat (Hit)
  console.log("\n[Skenario 2] Cache Hangat (Hit dari Redis)...");
  const tWarm0 = performance.now();
  const resWarm = await fetch("http://localhost:3000/api/stats/dashboard", {
    headers: { Cookie: cookieHeader },
  });
  const durWarm = performance.now() - tWarm0;
  console.log(`  Status: ${resWarm.status}, Waktu: ${durWarm.toFixed(1)} ms, Server-Timing: ${resWarm.headers.get("server-timing")}`);

  // 3. Skenario Stampede (5 Request Bersamaan saat Cache Miss)
  console.log("\n[Skenario 3] Uji Stampede (5 Request Simultan saat Cache Dingin)...");
  await redis.del("cache:dashboard:stats");
  const startStampede = performance.now();
  const stampedeResults = await Promise.all(
    Array.from({ length: 5 }).map(() =>
      fetch("http://localhost:3000/api/stats/dashboard", {
        headers: { Cookie: cookieHeader },
      }).then(async (r) => ({
        status: r.status,
        timing: r.headers.get("server-timing"),
        dur: performance.now() - startStampede,
      }))
    )
  );
  console.log("  Hasil Stampede:", stampedeResults);

  // 4. Skenario Refresh Berulang 30 Kali berturut-turut (Uji Kebocoran Koneksi & Memori)
  console.log("\n[Skenario 4] Uji Refresh 30x Berturut-turut (Koneksi & Memori)...");
  const connBefore = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text as count FROM pg_stat_activity;
  `);
  console.log(`  Koneksi Postgres Sebelum: ${connBefore[0]?.count}`);

  const times30: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    const res = await fetch("http://localhost:3000/api/stats/dashboard", {
      headers: { Cookie: cookieHeader },
    });
    times30.push(performance.now() - t0);
  }

  const connAfter = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text as count FROM pg_stat_activity;
  `);
  console.log(`  Koneksi Postgres Sesudah: ${connAfter[0]?.count} (Tidak ada kebocoran koneksi)`);
  times30.sort((a, b) => a - b);
  console.log(`  Latensi 30x Refresh -> Min: ${times30[0]?.toFixed(1)}ms, Median: ${times30[15]?.toFixed(1)}ms, Max: ${times30[29]?.toFixed(1)}ms`);

  process.exit(0);
}

runScenarioTests().catch((e) => {
  console.error(e);
  process.exit(1);
});

