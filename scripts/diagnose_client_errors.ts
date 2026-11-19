import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";

class CDPClient {
  private ws!: WebSocket;
  private idCounter = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  public onEvent?: (method: string, params: any) => void;

  async connect(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (event) => {
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

interface CapturedIssue {
  type: "exception" | "console_error" | "console_warn" | "application_error_screen" | "hydration_mismatch";
  page: string;
  message: string;
  stack?: string;
  details?: any;
}

async function main() {
  console.log("=== MEMULAI DIAGNOSIS KESALAHAN KLIEN (LANGKAH 1) ===");

  const issues: CapturedIssue[] = [];
  let currentPage = "";

  // 1. Hubungkan ke Chrome via CDP
  const versionRes = await fetch("http://127.0.0.1:9222/json/version");
  const version = await versionRes.json();

  const browserCdp = new CDPClient();
  await browserCdp.connect(version.webSocketDebuggerUrl);

  const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank" });
  const pageWsUrl = `ws://127.0.0.1:9222/devtools/page/${targetId}`;

  const pageCdp = new CDPClient();
  await pageCdp.connect(pageWsUrl);

  pageCdp.onEvent = (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Unknown exception";
      const stack = params.exceptionDetails?.stackTrace?.callFrames?.map((f: any) => `${f.functionName || "(anonymous)"} at ${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n");
      console.log(`\n❌ [EXCEPTION di ${currentPage}]`, desc);
      issues.push({
        type: "exception",
        page: currentPage,
        message: desc,
        stack,
        details: params.exceptionDetails,
      });
    }

    if (method === "Runtime.consoleAPICalled") {
      const text = params.args?.map((a: any) => a.value ?? a.description ?? "").join(" ");
      if (params.type === "error") {
        console.log(`\n⚠️ [CONSOLE.ERROR di ${currentPage}]`, text.slice(0, 300));
        const isHydration = text.toLowerCase().includes("hydration") || text.toLowerCase().includes("did not match");
        issues.push({
          type: isHydration ? "hydration_mismatch" : "console_error",
          page: currentPage,
          message: text,
          stack: params.stackTrace?.callFrames?.map((f: any) => `${f.functionName || "(anonymous)"} at ${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n"),
        });
      } else if (params.type === "warning") {
        if (text.toLowerCase().includes("hydration") || text.toLowerCase().includes("did not match") || text.toLowerCase().includes("prop `")) {
          console.log(`\n⚠️ [HYDRATION WARN di ${currentPage}]`, text.slice(0, 300));
          issues.push({
            type: "hydration_mismatch",
            page: currentPage,
            message: text,
          });
        }
      }
    }
  };

  await pageCdp.send("Page.enable");
  await pageCdp.send("Runtime.enable");
  await pageCdp.send("Log.enable");
  await pageCdp.send("Network.enable");

  // Siapkan sesi admin
  const [adminUser] = (await db.execute(sql`SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`)) as any;
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

  async function checkPage(pathUrl: string, waitMs = 2500, label = "") {
    currentPage = pathUrl + (label ? ` (${label})` : "");
    console.log(`\n--> Membuka halaman: ${currentPage}`);
    await pageCdp.send("Page.navigate", { url: `http://localhost:3000${pathUrl}` });
    await new Promise((r) => setTimeout(r, waitMs));

    // Cek apakah ada teks "Application error" di DOM
    const evalRes = await pageCdp.send("Runtime.evaluate", {
      expression: `
        document.body.innerText.includes("Application error: a client-side exception has occurred")
      `,
    });

    if (evalRes?.result?.value === true) {
      console.log(`🚨 [CRASH TERDETEKSI] "Application error: a client-side exception has occurred" di ${currentPage}`);
      issues.push({
        type: "application_error_screen",
        page: currentPage,
        message: "Layar Crash Bawaan Next.js Tampil (Application error)",
      });
    }
  }

  // 1. Desktop Viewport Test
  await pageCdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  await checkPage("/");
  await checkPage("/perangkat");
  await checkPage("/perangkat/58e4fedb-6b83-4e8c-8c9f-c12387a10217");

  // Cek tab-tab di detail perangkat
  const tabs = ["status", "logs", "incidents", "filters"];
  for (const t of tabs) {
    currentPage = `/perangkat/58e4fedb-6b83-4e8c-8c9f-c12387a10217#${t}`;
    console.log(`--> Menguji tab detail: ${t}`);
    await pageCdp.send("Runtime.evaluate", {
      expression: `
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('${t}'));
        if (btn) btn.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 1200));
  }

  await checkPage("/grup");
  await checkPage("/grup/0fa9df86-e9d7-485a-8246-6ddd8614c672");
  await checkPage("/peta", 3500, "Kanvas Peta Default");

  // Uji mode di peta
  console.log("--> Menguji mode Ubah Tata Letak di Peta...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Ubah Tata Letak'));
      if (editBtn) editBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("--> Menguji mode Daftar Peta...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const listBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Daftar'));
      if (listBtn) listBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("--> Menguji Metrik NOC di Peta...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const nocBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Metrik NOC'));
      if (nocBtn) nocBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("--> Menguji Mode Pantau...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const pantauBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Mode Pantau'));
      if (pantauBtn) pantauBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1500));

  await checkPage("/insiden");
  await checkPage("/pengguna");
  await checkPage("/pengaturan");

  // 2. Mobile Viewport Test (390 x 844)
  console.log("\n=== MENGUJI TAMPILAN MOBILE (390x844) ===");
  await pageCdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });

  await checkPage("/", 2000, "Mobile Dashboard");
  await checkPage("/perangkat", 2000, "Mobile Perangkat");
  await checkPage("/peta", 3000, "Mobile Peta");
  await checkPage("/insiden", 2000, "Mobile Insiden");

  // 3. Skenario Khusus: Data Tersimpan Rusak di localStorage
  console.log("\n=== MENGUJI SKENARIO LOCALSTORAGE RUSAK ===");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      localStorage.setItem("jagalog_map_collapsed_groups", "{INVALID_JSON_CORRUPT: true, missing_bracket");
      localStorage.setItem("jagalog_map_view_peta1", "null_not_array_12345");
      localStorage.setItem("jagalog_timeline_rentang", "INVALID_RENTANG_CRASH");
      localStorage.setItem("jagalog_timeline_skala", "INVALID_SKALA_CRASH");
    `,
  });
  await checkPage("/peta", 2500, "Peta dengan LocalStorage Rusak");
  await checkPage("/perangkat/58e4fedb-6b83-4e8c-8c9f-c12387a10217", 2000, "Timeline dengan LocalStorage Rusak");

  // 4. Skenario Khusus: ChunkLoadError / Module Fetch Error
  console.log("\n=== MENGUJI SKENARIO CHUNKLOADERROR ===");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const err = new Error("Loading chunk app/peta/page failed. (error: http://localhost:3000/_next/static/chunks/app/peta/page-missing.js)");
      err.name = "ChunkLoadError";
      window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
    `,
  });
  await new Promise((r) => setTimeout(r, 1000));

  // 5. Periksa Header Cache-Control dan Service Worker
  console.log("\n=== MEMERIKSA HEADER CACHE-CONTROL & SERVICE WORKER ===");
  const htmlHeadersRes = await fetch("http://localhost:3000/perangkat", { method: "HEAD" });
  console.log("Header /perangkat HTML Cache-Control:", htmlHeadersRes.headers.get("cache-control"));

  const swHeadersRes = await fetch("http://localhost:3000/sw.js", { method: "HEAD" });
  console.log("Header /sw.js Cache-Control:", swHeadersRes.headers.get("cache-control"));

  // Selesai
  pageCdp.close();
  browserCdp.close();

  console.log("\n=======================================================");
  console.log(`HASIL DIAGNOSIS: Total Temuan Isu = ${issues.length}`);
  console.log("=======================================================");
  for (let i = 0; i < issues.length; i++) {
    const iss = issues[i];
    console.log(`\n[${i + 1}] Tipe: ${iss.type.toUpperCase()}`);
    console.log(`    Halaman: ${iss.page}`);
    console.log(`    Pesan  : ${iss.message.slice(0, 250)}`);
    if (iss.stack) console.log(`    Stack  :\n${iss.stack.slice(0, 400)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic script error:", err);
  process.exit(1);
});

