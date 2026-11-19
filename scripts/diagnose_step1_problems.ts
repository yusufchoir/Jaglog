import { db } from "../shared/src/db";
import { users } from "../shared/src/schema";
import { eq, sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";
import { redis } from "../shared/src/redis";

async function main() {
  console.log("=== DIAGNOSIS LANGKAH 1 PERBAIKAN_LAGI ===");

  // A.1 & A.3: Cek users & role
  const allUsers = await db.select().from(users);
  console.log("\n[A.1] Data Users di DB:");
  for (const u of allUsers) {
    console.log(` - ID: ${u.id}, Username: ${u.username}, Role: ${u.role}, Active: ${u.isActive}`);
  }

  const adminUser = allUsers.find((u) => u.username === "admin");
  if (!adminUser) {
    console.error("User admin tidak ditemukan!");
    process.exit(1);
  }

  // A.3: Panggil session berkali-kali (50x) untuk uji konsistensi & latensi
  console.log("\n[A.3] Uji Konsistensi & Latensi Sesi Redis (50x pemanggilan):");
  const testSessionToken = await createSession({
    userId: adminUser.id,
    username: adminUser.username,
    role: adminUser.role as "admin" | "viewer",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  const { getSession } = await import("../shared/src/auth");
  const latencies: number[] = [];
  let roleMismatchCount = 0;
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    const s = await getSession(testSessionToken);
    const dur = performance.now() - t0;
    latencies.push(dur);
    if (!s || s.role !== "admin") {
      roleMismatchCount++;
    }
  }
  const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLat = Math.max(...latencies);
  const minLat = Math.min(...latencies);
  console.log(` - 50x getSession: Avg=${avgLat.toFixed(2)}ms, Min=${minLat.toFixed(2)}ms, Max=${maxLat.toFixed(2)}ms`);
  console.log(` - Role Mismatch / Null Count: ${roleMismatchCount}/50`);

  // A.4: Periksa Redis latency
  console.log("\n[A.4] Periksa Latensi Redis PING:");
  const redisPings: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await redis.ping();
    redisPings.push(performance.now() - t0);
  }
  console.log(` - Redis Ping: Avg=${(redisPings.reduce((a, b) => a + b, 0) / 10).toFixed(2)}ms, Max=${Math.max(...redisPings).toFixed(2)}ms`);

  // A.5: Cek otorisasi server pada /api/groups
  console.log("\n[A.5] Uji Otorisasi Server /api/groups:");
  // Buat sesi viewer untuk perbandingan
  const viewerSessionToken = await createSession({
    userId: "test-viewer-id",
    username: "test_viewer",
    role: "viewer",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  const resAdminGet = await fetch("http://localhost:3000/api/groups", {
    headers: { Cookie: `jagalog_session=${testSessionToken}` },
  });
  console.log(` - Admin GET /api/groups status: ${resAdminGet.status}`);

  const resViewerPost = await fetch("http://localhost:3000/api/groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `jagalog_session=${viewerSessionToken}`,
    },
    body: JSON.stringify({ nama: "Test Group Unauthorized", warnaGaris: "biru" }),
  });
  console.log(` - Viewer POST /api/groups status: ${resViewerPost.status}`);
  const viewerJson = await resViewerPost.json();
  console.log(`   Response:`, viewerJson);

  // Uji koneksi Chrome CDP untuk halaman /grup dan /
  console.log("\n[CDP] Menghubungkan ke Headless Chrome port 9222...");
  const newTabRes = await fetch("http://127.0.0.1:9222/json/new?http://localhost:3000", { method: "PUT" });
  const page = await newTabRes.json();
  const wsUrl = page.webSocketDebuggerUrl;
  const ws = new (globalThis as any).WebSocket(wsUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let cdpId = 1;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const msgId = cdpId++;
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
  await send("Runtime.enable");

  // Set session cookie admin di Chrome
  await send("Network.setCookie", {
    name: "jagalog_session",
    value: testSessionToken,
    domain: "localhost",
    path: "/",
  });

  // Track network requests and responses
  const requests: Array<{ url: string; method: string; timestamp: number; id: string }> = [];
  const responses: Array<{ url: string; status: number; duration?: number; id: string }> = [];
  const consoleMessages: Array<string> = [];

  ws.addEventListener("message", (evt: any) => {
    const msg = JSON.parse(evt.data.toString());
    if (msg.method === "Network.requestWillBeSent") {
      requests.push({
        id: msg.params.requestId,
        url: msg.params.request.url,
        method: msg.params.request.method,
        timestamp: Date.now(),
      });
    } else if (msg.method === "Network.responseReceived") {
      responses.push({
        id: msg.params.requestId,
        url: msg.params.response.url,
        status: msg.params.response.status,
      });
    } else if (msg.method === "Runtime.consoleAPICalled") {
      consoleMessages.push(msg.params.args.map((a: any) => a.value || a.description || "").join(" "));
    }
  });

  // 1. Diagnosis /grup
  console.log("\n[DIAGNOSIS 1 & 2] Membuka http://localhost:3000/grup di browser...");
  await send("Page.navigate", { url: "http://localhost:3000/grup" });
  await new Promise((r) => setTimeout(r, 2500));

  // Ambil menu navigasi yang tampil
  const navEvaluation = await send("Runtime.evaluate", {
    expression: `(() => {
      const links = Array.from(document.querySelectorAll("header nav a")).map(a => a.innerText.trim());
      const headerText = document.querySelector("header") ? document.querySelector("header").innerText : "";
      return { links, headerText };
    })()`,
    returnByValue: true,
  });

  console.log(" - Tautan Navigasi di /grup:", navEvaluation.result?.value?.links);
  console.log(" - Teks Header di /grup (mencari nama dan badge peran):");
  const headerLines = (navEvaluation.result?.value?.headerText || "").split("\n").map((l: string) => l.trim()).filter(Boolean);
  console.log("   Header content excerpt:", headerLines.slice(0, 15));

  const authMeReqs = responses.filter((r) => r.url.includes("/api/auth/me"));
  console.log(" - Request ke /api/auth/me:", authMeReqs.length, "respons. Status:", authMeReqs.map((r) => r.status));

  // 2. Diagnosis / (Dashboard)
  console.log("\n[DIAGNOSIS 3] Membuka http://localhost:3000/ (Dashboard) selama 8 detik untuk catat frekuensi request & loop...");
  requests.length = 0;
  responses.length = 0;
  consoleMessages.length = 0;

  const tStart = Date.now();
  await send("Page.navigate", { url: "http://localhost:3000/" });

  // Pantau selama 8 detik
  await new Promise((r) => setTimeout(r, 8000));
  const tEnd = Date.now();
  const totalSeconds = (tEnd - tStart) / 1000;

  const dashReqs = requests.filter((r) => r.url.includes("/api/stats/dashboard"));
  const streamReqs = requests.filter((r) => r.url.includes("/api/stream"));

  console.log(` - Selama ${totalSeconds.toFixed(1)} detik:`);
  console.log(`   * Request /api/stats/dashboard: ${dashReqs.length} kali (${(dashReqs.length / totalSeconds).toFixed(2)} req/detik)`);
  console.log(`   * Request /api/stream: ${streamReqs.length} kali`);

  const dashResponses = responses.filter((r) => r.url.includes("/api/stats/dashboard"));
  console.log(`   * Status respons /api/stats/dashboard:`, dashResponses.map((r) => r.status));

  // Periksa DOM Dashboard
  const dashDomEval = await send("Runtime.evaluate", {
    expression: `(() => {
      const bodyText = document.body.innerText;
      const hasErrorBanner = bodyText.includes("Gagal memuat data ringkasan dashboard.") || bodyText.includes("Memuat data dashboard membutuhkan waktu lebih lama");
      const errorText = Array.from(document.querySelectorAll("[role='alert']")).map(el => el.innerText);
      const headerLinks = Array.from(document.querySelectorAll("header nav a")).map(a => a.innerText.trim());
      const headerUserText = document.querySelector("header") ? document.querySelector("header").innerText : "";
      return { hasErrorBanner, errorText, headerLinks, headerUserText };
    })()`,
    returnByValue: true,
  });

  console.log(" - DOM Dashboard Error Banner:", dashDomEval.result?.value?.hasErrorBanner);
  console.log(" - Teks [role='alert']:", dashDomEval.result?.value?.errorText);
  console.log(" - Tautan Navigasi di Dashboard:", dashDomEval.result?.value?.headerLinks);
  console.log(" - Console Messages (last 10):", consoleMessages.slice(-10));

  // Tutup tab
  await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
  ws.close();
  console.log("\n=== SELESAI DIAGNOSIS ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnosis error:", err);
  process.exit(1);
});

