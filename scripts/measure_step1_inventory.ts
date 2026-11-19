import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";
import { redis } from "../shared/src/redis";

class CDPClient {
  private ws!: WebSocket;
  private idCounter = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  public onEvent?: (method: string, params: any) => void;

  async connect(wsUrl: string) {
    const WS = (globalThis as any).WebSocket || (await import("ws" as any)).default;
    this.ws = new WS(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e: any) => reject(e);
    });

    this.ws.onmessage = (event: any) => {
      const data = JSON.parse(event.data.toString());
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id)!;
        this.pending.delete(data.id);
        if (data.error) {
          reject(new Error(data.error.message));
        } else {
          resolve(data.result);
        }
      } else if (data.method && this.onEvent) {
        this.onEvent(data.method, data.params);
      }
    };
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.idCounter++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

interface RequestRecord {
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
  encodedDataLength: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  initiator: any;
}

async function run() {
  console.log("=================================================================");
  console.log("=== LANGKAH 1: INVENTARIS DAN PENGUKURAN BASELINE (PRODUKSI) ===");
  console.log("=================================================================\n");

  // 1. Reset pg_stat_statements
  await db.execute(sql`SELECT pg_stat_statements_reset()`);
  console.log("[DB] pg_stat_statements berhasil di-reset untuk pengukuran bersih.");

  // Dapatkan sampel perangkat uji
  const [sampleDevice] = (await db.execute(
    sql`SELECT id, name, type FROM devices ORDER BY id LIMIT 1`
  )) as any;
  const testDeviceId = sampleDevice?.id || "58e4fedb-6b83-4e8c-8c9f-c12387a10217";
  const testDeviceName = sampleDevice?.name || "Server DB PostgreSQL Linux";
  console.log(`[DB] Perangkat uji yang digunakan: ${testDeviceName} (${testDeviceId})`);

  // 2. Setup Chrome CDP
  const versionRes = await fetch("http://127.0.0.1:9222/json/version");
  const version = await versionRes.json();
  const browserCdp = new CDPClient();
  await browserCdp.connect(version.webSocketDebuggerUrl);

  const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank" });
  const pageWsUrl = `ws://127.0.0.1:9222/devtools/page/${targetId}`;
  const pageCdp = new CDPClient();
  await pageCdp.connect(pageWsUrl);

  await pageCdp.send("Page.enable");
  await pageCdp.send("Runtime.enable");
  await pageCdp.send("Network.enable");
  await pageCdp.send("Performance.enable");

  // Siapkan sesi admin
  const [adminUser] = (await db.execute(
    sql`SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`
  )) as any;
  const token = await createSession({
    userId: adminUser.id,
    username: adminUser.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  await pageCdp.send("Network.setCookie", {
    name: "jagalog_session",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });

  // Track network requests
  const networkRequests = new Map<string, Partial<RequestRecord>>();
  const completedRequests: RequestRecord[] = [];

  pageCdp.onEvent = (method, params) => {
    if (method === "Network.requestWillBeSent") {
      networkRequests.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        startTime: params.timestamp * 1000,
        initiator: params.initiator,
      });
    } else if (method === "Network.responseReceived") {
      const existing = networkRequests.get(params.requestId);
      if (existing) {
        existing.status = params.response.status;
        existing.mimeType = params.response.mimeType;
      }
    } else if (method === "Network.loadingFinished") {
      const existing = networkRequests.get(params.requestId);
      if (existing) {
        existing.endTime = params.timestamp * 1000;
        existing.durationMs = existing.endTime - (existing.startTime || existing.endTime);
        existing.encodedDataLength = params.encodedDataLength;
        completedRequests.push(existing as RequestRecord);
      }
    }
  };

  async function measurePage(url: string, pageLabel: string) {
    console.log(`\n>>> [MENGUKUR HALAMAN] ${pageLabel} (${url})`);
    completedRequests.length = 0;
    networkRequests.clear();

    const t0 = performance.now();
    await pageCdp.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 3500)); // tunggu data lengkap tampil
    const totalElapsed = performance.now() - t0;

    // Ambil metrik performa browser
    const perfTiming = await pageCdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const nav = performance.getEntriesByType("navigation")[0];
          const paint = performance.getEntriesByType("paint");
          const fcp = paint.find(p => p.name === "first-contentful-paint");
          return {
            ttfb: nav ? nav.responseStart - nav.requestStart : 0,
            domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
            loadEvent: nav ? nav.loadEventEnd - nav.startTime : 0,
            fcp: fcp ? fcp.startTime : 0,
          };
        })()
      `,
      returnByValue: true,
    });

    const timing = perfTiming.result?.value || {};
    console.log(`  - Waktu Kerangka Tampil (TTFB): ${timing.ttfb?.toFixed(1)} ms`);
    console.log(`  - First Contentful Paint (FCP): ${timing.fcp?.toFixed(1)} ms`);
    console.log(`  - DOM Content Loaded: ${timing.domContentLoaded?.toFixed(1)} ms`);
    console.log(`  - Load Event End: ${timing.loadEvent?.toFixed(1)} ms`);
    console.log(`  - Total Observasi Data Tampil: ${totalElapsed.toFixed(1)} ms`);

    // Ringkasan Request & Ukuran
    console.log(`  - Jumlah Request: ${completedRequests.length}`);
    let totalBytes = 0;
    let jsBytes = 0;
    let apiBytes = 0;

    console.log("  - Urutan Request Waterfall (Top 10):");
    completedRequests.slice(0, 10).forEach((req, idx) => {
      const urlShort = req.url.replace("http://localhost:3000", "");
      const kb = (req.encodedDataLength / 1024).toFixed(1);
      console.log(`    ${idx + 1}. [${req.method}] ${req.status} ${urlShort.slice(0, 70)} | ${kb} KB | ${req.durationMs.toFixed(1)} ms`);
    });

    for (const req of completedRequests) {
      totalBytes += req.encodedDataLength || 0;
      if (req.url.includes(".js") || req.mimeType?.includes("javascript")) {
        jsBytes += req.encodedDataLength || 0;
      }
      if (req.url.includes("/api/")) {
        apiBytes += req.encodedDataLength || 0;
      }
    }

    console.log(`  - Total Ukuran Respons: ${(totalBytes / 1024).toFixed(1)} KB`);
    console.log(`  - Total Bundle JS: ${(jsBytes / 1024).toFixed(1)} KB`);
    console.log(`  - Total Respons API: ${(apiBytes / 1024).toFixed(1)} KB`);

    return {
      timing,
      totalElapsed,
      requestsCount: completedRequests.length,
      totalBytesKb: (totalBytes / 1024).toFixed(1),
      jsBytesKb: (jsBytes / 1024).toFixed(1),
      apiBytesKb: (apiBytes / 1024).toFixed(1),
      requests: [...completedRequests],
    };
  }

  // 3. Ukur halaman Dashboard (/)
  const dashboardMetrics = await measurePage("http://localhost:3000/", "Dashboard (/)");

  // 4. Ukur Tab Ringkasan Perangkat (/perangkat/[id])
  const deviceRingkasanMetrics = await measurePage(
    `http://localhost:3000/perangkat/${testDeviceId}?tab=ringkasan`,
    "Detail Perangkat - Tab Ringkasan"
  );

  // 5. Ukur Event Log Perangkat:
  // 5a. Default tanpa filter
  const deviceLogDefaultMetrics = await measurePage(
    `http://localhost:3000/perangkat/${testDeviceId}?tab=log`,
    "Detail Perangkat - Tab Event Log (Default)"
  );

  // 5b. Rentang 24 jam
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const fromIso = dayAgo.toISOString();
  const toIso = now.toISOString();
  const deviceLog24hMetrics = await measurePage(
    `http://localhost:3000/perangkat/${testDeviceId}?tab=log&rentang=24j&dari=${encodeURIComponent(fromIso)}&sampai=${encodeURIComponent(toIso)}`,
    "Detail Perangkat - Tab Event Log (Rentang 24 Jam)"
  );

  // 5c. Dengan pencarian teks
  const deviceLogSearchMetrics = await measurePage(
    `http://localhost:3000/perangkat/${testDeviceId}?tab=log&search=system`,
    "Detail Perangkat - Tab Event Log (Pencarian Teks: 'system')"
  );

  // 6. Ambil 10 Query Teratas dari pg_stat_statements
  console.log("\n=================================================================");
  console.log("=== 10 QUERY TERATAS DARI PG_STAT_STATEMENTS ===");
  console.log("=================================================================");
  const topQueries = (await db.execute(sql`
    SELECT
      query,
      calls,
      round(total_exec_time::numeric, 2) AS total_ms,
      round(mean_exec_time::numeric, 2) AS mean_ms,
      round(min_exec_time::numeric, 2) AS min_ms,
      round(max_exec_time::numeric, 2) AS max_ms,
      rows
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%' AND query NOT LIKE '%pg_catalog%'
    ORDER BY total_exec_time DESC
    LIMIT 10
  `)) as any;

  topQueries.forEach((q: any, i: number) => {
    console.log(`\n#${i + 1} | Calls: ${q.calls} | Total: ${q.total_ms} ms | Mean: ${q.mean_ms} ms | Rows: ${q.rows}`);
    console.log(`  Query: ${q.query.slice(0, 180)}...`);
  });

  // 7. EXPLAIN (ANALYZE, BUFFERS) untuk query-query inti
  console.log("\n=================================================================");
  console.log("=== EXPLAIN (ANALYZE, BUFFERS) QUERY-QUERY UTAMA ===");
  console.log("=================================================================");

  async function runExplain(label: string, queryStr: string) {
    console.log(`\n--- EXPLAIN: ${label} ---`);
    console.log(`SQL: ${queryStr.slice(0, 150)}...`);
    try {
      const explainRes = (await db.execute(sql.raw(`EXPLAIN (ANALYZE, BUFFERS) ${queryStr}`))) as any;
      explainRes.forEach((row: any) => {
        console.log("  " + row["QUERY PLAN"]);
      });
    } catch (err: any) {
      console.log("  [EXPLAIN Error]", err.message);
    }
  }

  // Q1: Dashboard Hourly Chart
  await runExplain(
    "Dashboard - Hourly Volume Log (24 Jam)",
    `SELECT to_char(date_trunc('hour', event_time AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00') AS hour_slot, COUNT(*)::text AS count FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours' GROUP BY hour_slot ORDER BY hour_slot ASC`
  );

  // Q2: Dashboard Total Logs 24h
  await runExplain(
    "Dashboard - Total Logs 24h",
    `SELECT count(*) FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours'`
  );

  // Q3: Dashboard Per-Device Log Count 24h
  await runExplain(
    "Dashboard - Per-Device Log Count (24 Jam)",
    `SELECT device_id, COUNT(*)::text as count FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours' GROUP BY device_id`
  );

  // Q4: Dashboard Sparkline (6 Jam)
  await runExplain(
    "Dashboard - Sparkline Per-Device (6 Jam)",
    `SELECT device_id, to_char(date_trunc('hour', event_time), 'YYYY-MM-DD HH24') as time_bucket, COUNT(*)::text as count FROM log_events WHERE event_time >= NOW() - INTERVAL '6 hours' GROUP BY device_id, time_bucket`
  );

  // Q5: Device Detail - Top Source IPs (JSON extraction)
  await runExplain(
    "Device Stats - Top 5 Source IPs (JSON extract)",
    `SELECT parsed->>'src_ip' AS ip, COUNT(*)::text as count FROM log_events WHERE device_id = '${testDeviceId}'::uuid AND event_time >= NOW() - INTERVAL '24 hours' AND parsed->>'src_ip' IS NOT NULL AND parsed->>'src_ip' != '' GROUP BY parsed->>'src_ip' ORDER BY COUNT(*) DESC LIMIT 5`
  );

  // Q6: Device Detail - Top Accounts (JSON extract)
  await runExplain(
    "Device Stats - Top 5 Accounts (JSON extract)",
    `SELECT parsed->>'actor' AS account, COUNT(*)::text as count FROM log_events WHERE device_id = '${testDeviceId}'::uuid AND event_time >= NOW() - INTERVAL '24 hours' AND parsed->>'actor' IS NOT NULL AND parsed->>'actor' != '' GROUP BY parsed->>'actor' ORDER BY COUNT(*) DESC LIMIT 5`
  );

  // Q7: Event Log - Default List Query
  await runExplain(
    "Event Log - Default List (device_id, limit 51)",
    `SELECT id, received_at, event_time, severity, facility, source_app, category, message, raw, parsed, repeat_count, first_event_time FROM log_events WHERE device_id = '${testDeviceId}'::uuid ORDER BY event_time DESC, id DESC LIMIT 51`
  );

  // Q8: Event Log - Count and Merged Sum on entire table for device
  await runExplain(
    "Event Log - Count(*) & Merged Sum",
    `SELECT count(*)::int, COALESCE(SUM(CASE WHEN repeat_count > 1 THEN repeat_count - 1 ELSE 0 END), 0)::int FROM log_events WHERE device_id = '${testDeviceId}'::uuid`
  );

  // Q9: Event Log - Text Search (ILIKE %system%)
  await runExplain(
    "Event Log - Text Search ILIKE %system%",
    `SELECT id, received_at, event_time, severity, message FROM log_events WHERE device_id = '${testDeviceId}'::uuid AND message ILIKE '%system%' ORDER BY event_time DESC, id DESC LIMIT 51`
  );

  // 8. Cek Status Cache Redis
  console.log("\n=================================================================");
  console.log("=== STATUS CACHE REDIS & HIT RATES ===");
  console.log("=================================================================");
  try {
    const dCache = await redis.get("cache:dashboard:stats");
    const dCacheTtl = await redis.ttl("cache:dashboard:stats");
    console.log(`- cache:dashboard:stats: ${dCache ? "TERSEDIA" : "KOSONG"} | TTL: ${dCacheTtl}s`);

    const devKeys = await redis.keys(`cache:device:stats:*`);
    console.log(`- cache:device:stats:* keys: ${devKeys.length} kunci ditemukan`);
    if (devKeys.length > 0) {
      const devTtl = await redis.ttl(devKeys[0]);
      console.log(`  Contoh key: ${devKeys[0]} | TTL: ${devTtl}s`);
    }

    const timelineKeys = await redis.keys(`cache:timeline:*`);
    console.log(`- cache:timeline:* keys: ${timelineKeys.length} kunci ditemukan`);
    if (timelineKeys.length > 0) {
      const tmTtl = await redis.ttl(timelineKeys[0]);
      console.log(`  Contoh key: ${timelineKeys[0]} | TTL: ${tmTtl}s`);
    }

    const redisInfo = await redis.info("stats");
    const hitsMatch = redisInfo.match(/keyspace_hits:(\d+)/);
    const missMatch = redisInfo.match(/keyspace_misses:(\d+)/);
    const hits = hitsMatch ? parseInt(hitsMatch[1], 10) : 0;
    const misses = missMatch ? parseInt(missMatch[1], 10) : 0;
    const hitRate = hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : "0";
    console.log(`- Redis Stats: Hits = ${hits}, Misses = ${misses}, Hit Rate = ${hitRate}%`);
  } catch (err: any) {
    console.error("- Gagal membaca info Redis:", err.message);
  }

  // 9. Konfigurasi Host & Container
  console.log("\n=================================================================");
  console.log("=== KONFIGURASI BASIS DATA & INFRASTRUKTUR ===");
  console.log("=================================================================");
  const os = await import("node:os");
  console.log(`- Host OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`- CPU Cores: ${os.cpus().length}`);
  console.log(`- Total RAM Host: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)} GB`);
  console.log(`- Free RAM Host: ${(os.freemem() / (1024 * 1024 * 1024)).toFixed(1)} GB`);

  const [dbSettings] = (await db.execute(sql`
    SELECT 
      current_setting('shared_buffers') as shared_buffers,
      current_setting('work_mem') as work_mem,
      current_setting('max_connections') as max_connections,
      current_setting('effective_cache_size') as effective_cache_size,
      current_setting('statement_timeout') as statement_timeout
  `)) as any;
  console.log(`- PostgreSQL shared_buffers: ${dbSettings.shared_buffers}`);
  console.log(`- PostgreSQL work_mem: ${dbSettings.work_mem}`);
  console.log(`- PostgreSQL max_connections: ${dbSettings.max_connections}`);
  console.log(`- PostgreSQL effective_cache_size: ${dbSettings.effective_cache_size}`);
  console.log(`- PostgreSQL statement_timeout: ${dbSettings.statement_timeout || "0 (tidak ada batas)"}`);

  pageCdp.close();
  browserCdp.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

