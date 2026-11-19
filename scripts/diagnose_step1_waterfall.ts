import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function runDiagnosis() {
  console.log("=== MEMULAI DIAGNOSIS LANGKAH 1 (CDP) ===");

  // 1. Dapatkan sesi admin
  const sessionUser = await db.execute<{ id: string; username: string }>(sql`
    SELECT id, username FROM users WHERE role = 'admin' LIMIT 1;
  `);

  if (!sessionUser[0]) {
    console.error("User admin tidak ditemukan.");
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
  console.log("Admin session dibuat:", sessionId);

  // 2. Hubungkan ke Chrome CDP
  const versionRes = await fetch("http://127.0.0.1:9222/json/version");
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;

  const ws = new (globalThis as any).WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e: any) => reject(e);
  });

  let idCounter = 1;
  const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  function send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const networkRequests = new Map<string, {
    url: string;
    method: string;
    startTime: number;
    endTime?: number;
    status?: number;
    mimeType?: string;
    encodedDataLength?: number;
    timing?: any;
    serverTiming?: any;
  }>();

  const consoleLogs: string[] = [];

  ws.onmessage = (event: any) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
    } else if (msg.method === "Network.requestWillBeSent") {
      networkRequests.set(msg.params.requestId, {
        url: msg.params.request.url,
        method: msg.params.request.method,
        startTime: msg.params.timestamp,
      });
    } else if (msg.method === "Network.responseReceived") {
      const req = networkRequests.get(msg.params.requestId);
      if (req) {
        req.status = msg.params.response.status;
        req.mimeType = msg.params.response.mimeType;
        req.timing = msg.params.response.timing;
        req.serverTiming = msg.params.response.headers["server-timing"] || msg.params.response.headers["Server-Timing"];
      }
    } else if (msg.method === "Network.loadingFinished") {
      const req = networkRequests.get(msg.params.requestId);
      if (req) {
        req.endTime = msg.params.timestamp;
        req.encodedDataLength = msg.params.encodedDataLength;
      }
    } else if (msg.method === "Runtime.consoleAPICalled") {
      consoleLogs.push(`[${msg.params.type}] ${msg.params.args.map((a: any) => a.value || JSON.stringify(a)).join(" ")}`);
    }
  };

  // Create new target/tab
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: cdpSessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

  function sendTab(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId: cdpSessionId }));
    });
  }

  await sendTab("Network.enable");
  await sendTab("Page.enable");
  await sendTab("Runtime.enable");

  // Set cookie
  await sendTab("Network.setCookie", {
    name: "jagalog_session",
    value: sessionId,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });

  console.log("\n--- TEST 1: Cache Browser NONAKTIF (Disable Cache = true) ---");
  await sendTab("Network.setCacheDisabled", { cacheDisabled: true });

  const navStart1 = performance.now();
  await sendTab("Page.navigate", { url: "http://localhost:3000/" });

  // Tunggu sampai halaman selesai me-render data dashboard
  await new Promise((r) => setTimeout(r, 4000));

  // Ambil metrik performa
  const perfMetrics1 = await sendTab("Runtime.evaluate", {
    expression: `
      (() => {
        const perf = window.performance;
        const nav = perf.getEntriesByType('navigation')[0] || {};
        const paint = perf.getEntriesByType('paint');
        const fcp = paint.find(p => p.name === 'first-contentful-paint');
        return {
          ttfb: nav.responseStart - nav.requestStart,
          domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          loadEvent: nav.loadEventEnd - nav.startTime,
          fcp: fcp ? fcp.startTime : null,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Performance Nav 1 (Disable Cache):", perfMetrics1.result?.value);

  // Periksa apakah data kartu sudah terisi
  const domContent1 = await sendTab("Runtime.evaluate", {
    expression: `
      (() => {
        return {
          title: document.title,
          h1: document.querySelector('h1')?.innerText,
          totalPerangkat: document.body.innerText.includes('PERANGKAT TERPANTAU'),
          jumlahPerangkatText: document.querySelector('h1 + p')?.innerText,
          hasChart: !!document.querySelector('svg'),
          hasIncidents: document.body.innerText.includes('INSIDEN KEAMANAN TERBUKA'),
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("DOM State 1:", domContent1.result?.value);

  console.log("\n--- DAFTAR REQUEST (Waterfall Test 1): ---");
  const sortedReqs = Array.from(networkRequests.values()).sort((a, b) => a.startTime - b.startTime);
  const baseT = sortedReqs[0]?.startTime || 0;
  for (const r of sortedReqs) {
    const startRel = ((r.startTime - baseT) * 1000).toFixed(1);
    const dur = r.endTime ? ((r.endTime - r.startTime) * 1000).toFixed(1) : "pending";
    const size = r.encodedDataLength ? `${(r.encodedDataLength / 1024).toFixed(1)} KB` : "-";
    console.log(`[+${startRel.padStart(6)} ms] [Dur: ${dur.padStart(7)} ms] [${r.status || '...'} ${r.method}] ${r.url.replace('http://localhost:3000', '')} (${size}) ${r.serverTiming ? `[Server-Timing: ${r.serverTiming}]` : ''}`);
  }

  console.log("\nConsole Logs:");
  consoleLogs.forEach((l) => console.log("  ", l));

  // TEST 2: Cache Browser AKTIF (Reload dengan Cache Aktif)
  console.log("\n--- TEST 2: Cache Browser AKTIF (Disable Cache = false, Reload) ---");
  await sendTab("Network.setCacheDisabled", { cacheDisabled: false });
  networkRequests.clear();
  consoleLogs.length = 0;

  await sendTab("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 4000));

  const perfMetrics2 = await sendTab("Runtime.evaluate", {
    expression: `
      (() => {
        const perf = window.performance;
        const nav = perf.getEntriesByType('navigation')[0] || {};
        const paint = perf.getEntriesByType('paint');
        const fcp = paint.find(p => p.name === 'first-contentful-paint');
        return {
          ttfb: nav.responseStart - nav.requestStart,
          domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          loadEvent: nav.loadEventEnd - nav.startTime,
          fcp: fcp ? fcp.startTime : null,
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("Performance Nav 2 (Cache Aktif):", perfMetrics2.result?.value);

  const sortedReqs2 = Array.from(networkRequests.values()).sort((a, b) => a.startTime - b.startTime);
  const baseT2 = sortedReqs2[0]?.startTime || 0;
  for (const r of sortedReqs2) {
    const startRel = ((r.startTime - baseT2) * 1000).toFixed(1);
    const dur = r.endTime ? ((r.endTime - r.startTime) * 1000).toFixed(1) : "pending";
    const size = r.encodedDataLength ? `${(r.encodedDataLength / 1024).toFixed(1)} KB` : "-";
    console.log(`[+${startRel.padStart(6)} ms] [Dur: ${dur.padStart(7)} ms] [${r.status || '...'} ${r.method}] ${r.url.replace('http://localhost:3000', '')} (${size}) ${r.serverTiming ? `[Server-Timing: ${r.serverTiming}]` : ''}`);
  }

  // Close tab
  await send("Target.closeTarget", { targetId });
  ws.close();
  process.exit(0);
}

runDiagnosis().catch((err) => {
  console.error("Diagnosis error:", err);
  process.exit(1);
});
