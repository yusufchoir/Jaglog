import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = "/Users/yahyahidayatullah/.gemini/antigravity/brain/54d19315-3e3d-4da7-a358-f1158d6c4819";

async function captureScreenshots() {
  console.log("=== Mengambil Screenshot Verifikasi Akhir Langkah 3 (perbaikan_detail_perangkat) ===");

  const res = await fetch("http://127.0.0.1:9222/json/new?http://localhost:3000", { method: "PUT" });
  const page = await res.json();
  const wsUrl = page.webSocketDebuggerUrl;

  const ws = new (globalThis as any).WebSocket(wsUrl);
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

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];

  ws.addEventListener("message", (evt: any) => {
    try {
      const parsed = JSON.parse(evt.data.toString());
      if (parsed.method === "Runtime.consoleAPICalled") {
        const type = parsed.params.type;
        const text = parsed.params.args?.map((a: any) => a.value || a.description || "").join(" ") || "";
        if (type === "error") {
          consoleErrors.push(text);
        } else if (type === "warning") {
          consoleWarnings.push(text);
        }
      }
    } catch {}
  });

  await send("Page.enable");
  await send("Network.enable");
  await send("Runtime.enable");

  // Dapatkan sesi admin dari database
  const { db } = await import("../shared/src/db");
  const { sql } = await import("drizzle-orm");
  const sessionUser = (await db.execute(sql`
    SELECT id, username FROM users WHERE role = 'admin' LIMIT 1;
  `)) as any[];

  if (sessionUser[0]) {
    const { createSession } = await import("../shared/src/auth");
    const sessionId = await createSession({
      userId: sessionUser[0].id,
      username: sessionUser[0].username,
      role: "admin",
      mustChangePassword: false,
      createdAt: Date.now(),
    });
    await send("Network.setCookie", {
      name: "jagalog_session",
      value: sessionId,
      domain: "localhost",
      path: "/",
    });
  }

  // Ambil perangkat yang aktif/valid dari database
  const devRows = (await db.execute(sql`
    SELECT id, name FROM devices WHERE status = 'rto' OR status = 'online' ORDER BY created_at ASC LIMIT 1;
  `)) as any[];
  const validDev = devRows[0] || { id: "c1b343fb-8142-4cb2-a4c0-eae8140c7e7c", name: "CCTV NVR Gateway" };

  // 1. Screenshot Detail Perangkat Desktop (1440x900)
  console.log(`1. Screenshot Detail Perangkat Desktop 1440px (${validDev.name})...`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `http://localhost:3000/perangkat/${validDev.id}` });
  await new Promise((r) => setTimeout(r, 3000));
  const devDesktop = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_desktop.png"), Buffer.from(devDesktop.data, "base64"));
  console.log("   ✓ Tersimpan: detail_perangkat_desktop.png");

  // 2. Screenshot Detail Perangkat Mobile 469px (seperti di screenshot issue pengguna)
  console.log(`2. Screenshot Detail Perangkat Mobile 469px (${validDev.name})...`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 469,
    height: 900,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const devMobile469 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_mobile_469.png"), Buffer.from(devMobile469.data, "base64"));
  console.log("   ✓ Tersimpan: detail_perangkat_mobile_469.png");

  // 3. Screenshot Detail Perangkat Mobile 390px (standar smartphone)
  console.log(`3. Screenshot Detail Perangkat Mobile 390px (${validDev.name})...`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const devMobile390 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_mobile_390.png"), Buffer.from(devMobile390.data, "base64"));
  console.log("   ✓ Tersimpan: detail_perangkat_mobile_390.png");

  // 4. Screenshot Halaman Non-Existent Device (dc169921-54f2-464e-9dd1-006eb9d8c261) Desktop
  const notFoundId = "dc169921-54f2-464e-9dd1-006eb9d8c261";
  console.log(`4. Screenshot Non-Existent Device Desktop (${notFoundId})...`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `http://localhost:3000/perangkat/${notFoundId}` });
  await new Promise((r) => setTimeout(r, 2500));
  const notFoundDesktop = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_404_desktop.png"), Buffer.from(notFoundDesktop.data, "base64"));
  console.log("   ✓ Tersimpan: detail_perangkat_404_desktop.png");

  // 5. Screenshot Halaman Non-Existent Device (dc169921-54f2-464e-9dd1-006eb9d8c261) Mobile 469px
  console.log(`5. Screenshot Non-Existent Device Mobile 469px (${notFoundId})...`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 469,
    height: 900,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const notFoundMobile469 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_404_mobile_469.png"), Buffer.from(notFoundMobile469.data, "base64"));
  console.log("   ✓ Tersimpan: detail_perangkat_404_mobile_469.png");

  console.log("\n--- Ringkasan Konsol Browser ---");
  const filteredErrors = consoleErrors.filter(
    (e) => !e.includes("favicon") && !e.includes("Download the React DevTools")
  );
  const reactErrors = filteredErrors.filter((e) => e.includes("300") || e.includes("fewer hooks") || e.includes("Minified React error"));
  const http500Errors = filteredErrors.filter((e) => e.includes("500") || e.includes("ERR-DEVSTATS"));
  const pwaWarnings = consoleWarnings.filter((w) => w.includes("beforeinstallprompt"));

  console.log(`Total Console Messages Captured: ${consoleErrors.length} errors, ${consoleWarnings.length} warnings`);
  console.log(`Filtered Console Errors: ${filteredErrors.length}`);
  console.log(`React Errors: ${reactErrors.length} (Bersih: ${reactErrors.length === 0 ? "YA" : "TIDAK"})`);
  console.log(`HTTP 500 / ERR-DEVSTATS Errors: ${http500Errors.length} (Bersih: ${http500Errors.length === 0 ? "YA" : "TIDAK"})`);
  console.log(`PWA beforeinstallprompt Warnings: ${pwaWarnings.length} (Bersih: ${pwaWarnings.length === 0 ? "YA" : "TIDAK"})`);

  await send("Page.close");
  ws.close();
  process.exit(0);
}

captureScreenshots().catch((err) => {
  console.error("Screenshot error:", err);
  process.exit(1);
});

