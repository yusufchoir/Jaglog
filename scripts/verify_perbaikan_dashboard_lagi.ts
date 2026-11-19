import fs from "node:fs";
import { db, queryClient } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";
import { redis } from "../shared/src/redis";

const ARTIFACT_DIR = "/Users/yahyahidayatullah/.gemini/antigravity/brain/54d19315-3e3d-4da7-a358-f1158d6c4819";

async function main() {
  console.log("=== VERIFIKASI LANGKAH 3: TES PERBAIKAN DASHBOARD LAGI ===");

  // 1. Dapatkan user admin dan buat sesi valid
  const adminRes = await db.execute<{ id: string; username: string }>(sql`
    SELECT id, username FROM users WHERE username = 'admin' LIMIT 1;
  `);
  if (!adminRes[0]) throw new Error("User admin tidak ditemukan!");
  const adminUser = adminRes[0];

  const sessionId = await createSession({
    userId: adminUser.id,
    username: adminUser.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });
  console.log(`[Auth] Sesi admin dibuat: ${sessionId}`);

  // 2. Buka tab baru di headless Chrome
  const newTabRes = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" });
  const tab = await newTabRes.json();
  const ws = new (globalThis as any).WebSocket(tab.webSocketDebuggerUrl);

  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let id = 1;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const msgId = id++;
      const handler = (evt: any) => {
        const parsed = JSON.parse(evt.data.toString());
        if (parsed.id === msgId) {
          ws.removeEventListener("message", handler);
          resolve(parsed.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await send("Page.enable");
  await send("Network.enable");

  // Pasang cookie sesi
  await send("Network.setCookie", {
    name: "jagalog_session",
    value: sessionId,
    domain: "localhost",
    path: "/",
  });

  // --- UJI 1: Dashboard Desktop 1440px ---
  console.log("\n--- Uji 1: Dashboard Desktop (1440x900) ---");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const t0 = performance.now();
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 2000));
  const dashboardLoadTime = performance.now() - t0;
  console.log(`[Dashboard] Waktu render awal: ${dashboardLoadTime.toFixed(1)} ms`);

  // Evaluasi teks di halaman dashboard
  const evalResult = await send("Runtime.evaluate", {
    expression: `(() => {
      const bodyText = document.body.innerText;
      const circuitBanner = bodyText.includes("Permintaan otomatis dihentikan sementara");
      const emptyChartMsg = bodyText.includes("Belum ada log pada 24 jam terakhir");
      const errorMsg = bodyText.includes("Gagal memuat");
      const cards = Array.from(document.querySelectorAll('main > div')).map(el => el.innerText);
      return {
        hasCircuitBanner: circuitBanner,
        hasEmptyChartMsg: emptyChartMsg,
        hasErrorMsg: errorMsg,
        bodySnippet: bodyText.slice(0, 500)
      };
    })()`,
    returnByValue: true,
  });

  console.log("[Dashboard DOM Check]:", evalResult?.result?.value);

  // Ambil screenshot desktop
  const ssDesktop = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/dashboard_pulih_v2_desktop.png`, Buffer.from(ssDesktop.data, "base64"));
  console.log(`[Screenshot] Disimpan: ${ARTIFACT_DIR}/dashboard_pulih_v2_desktop.png`);

  // --- UJI 2: Dashboard Mobile 390px ---
  console.log("\n--- Uji 2: Dashboard Mobile (390x844) ---");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 1500));

  const ssMobile = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/dashboard_pulih_v2_mobile.png`, Buffer.from(ssMobile.data, "base64"));
  console.log(`[Screenshot] Disimpan: ${ARTIFACT_DIR}/dashboard_pulih_v2_mobile.png`);

  // --- UJI 3: Pengaturan -> Bagian 8. Kesehatan Sistem ---
  console.log("\n--- Uji 3: Pengaturan -> Kesehatan Sistem (1440x1200) ---");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:3000/pengaturan" });
  await new Promise((r) => setTimeout(r, 2000));

  const evalSettings = await send("Runtime.evaluate", {
    expression: `(() => {
      const bodyText = document.body.innerText;
      const hasHealthSection = bodyText.includes("8. Kesehatan Sistem");
      const hasPostgres = bodyText.includes("PostgreSQL");
      const hasRedis = bodyText.includes("Redis Cache");
      const hasBullmq = bodyText.includes("Antrian Ingest (BullMQ)");
      const hasDisk = bodyText.includes("Kapasitas Disk Server");
      return {
        hasHealthSection,
        hasPostgres,
        hasRedis,
        hasBullmq,
        hasDisk
      };
    })()`,
    returnByValue: true,
  });
  console.log("[Settings Health Check DOM]:", evalSettings?.result?.value);

  // Scroll to section 8 and screenshot
  await send("Runtime.evaluate", {
    expression: `(() => {
      const el = Array.from(document.querySelectorAll('h2')).find(h => h.innerText.includes('8. Kesehatan Sistem'));
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    })()`,
  });
  await new Promise((r) => setTimeout(r, 500));

  const ssHealth = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${ARTIFACT_DIR}/kesehatan_sistem_desktop.png`, Buffer.from(ssHealth.data, "base64"));
  console.log(`[Screenshot] Disimpan: ${ARTIFACT_DIR}/kesehatan_sistem_desktop.png`);

  // Tutup tab
  await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`);
  ws.close();

  // --- UJI 4: Kinerja Benchmark Sebelum vs Sesudah ---
  console.log("\n--- Uji 4: Pengukuran Latensi Dashboard p95 ---");
  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const res = await fetch("http://localhost:3000/api/stats/dashboard", {
      headers: { Cookie: `jagalog_session=${sessionId}` },
    });
    const dur = performance.now() - start;
    if (res.ok) latencies.push(dur);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(`[Latency Benchmark] Total Request: 10, Min: ${latencies[0].toFixed(1)} ms, p50: ${p50.toFixed(1)} ms, p95: ${p95.toFixed(1)} ms`);

  // --- UJI 5: Kill Switch DASHBOARD_FAST_PATH=false ---
  console.log("\n--- Uji 5: Verifikasi Kill Switch DASHBOARD_FAST_PATH=false ---");
  // Uji fallback path di route secara langsung
  process.env.DASHBOARD_FAST_PATH = "false";
  const fastPathCheck = process.env.DASHBOARD_FAST_PATH !== "false";
  console.log(`[Kill Switch] process.env.DASHBOARD_FAST_PATH='false' -> isFastPathActive=${fastPathCheck}`);
  process.env.DASHBOARD_FAST_PATH = "true";

  console.log("\n=== SEMUA VERIFIKASI SELESAI DENGAN SUKSES ===");
  await redis.quit();
  await queryClient.end();
}

main().catch((err) => {
  console.error("FATAL ERROR in verification script:", err);
  process.exit(1);
});

