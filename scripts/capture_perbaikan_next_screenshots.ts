import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = "/Users/yahyahidayatullah/.gemini/antigravity/brain/54d19315-3e3d-4da7-a358-f1158d6c4819";

async function captureScreenshots() {
  console.log("=== Mengambil Screenshot Verifikasi Akhir Langkah 3 ===");

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

  await send("Page.enable");
  await send("Network.enable");

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

  // 1. Screenshot Dashboard Desktop (1440x900)
  console.log("1. Screenshot Dashboard Desktop (1440px)...");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 2500));
  const dashDesktop = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "dashboard_perbaikan_next_desktop.png"), Buffer.from(dashDesktop.data, "base64"));
  console.log("   ✓ Tersimpan: dashboard_perbaikan_next_desktop.png");

  // 2. Screenshot Dashboard Mobile (390x844)
  console.log("2. Screenshot Dashboard Mobile (390px)...");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 1500));
  const dashMobile = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "dashboard_perbaikan_next_mobile.png"), Buffer.from(dashMobile.data, "base64"));
  console.log("   ✓ Tersimpan: dashboard_perbaikan_next_mobile.png");

  // 3. Screenshot Detail Perangkat Desktop (1440px)
  const devRows = (await db.execute(sql`
    SELECT id, name FROM devices ORDER BY name ASC LIMIT 1;
  `)) as any[];

  if (devRows[0]) {
    console.log(`3. Screenshot Detail Perangkat (${devRows[0].name}) (1440px)...`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `http://localhost:3000/perangkat/${devRows[0].id}` });
    await new Promise((r) => setTimeout(r, 2500));
    const devDesktop = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(ARTIFACT_DIR, "detail_perangkat_perbaikan_next_desktop.png"), Buffer.from(devDesktop.data, "base64"));
    console.log("   ✓ Tersimpan: detail_perangkat_perbaikan_next_desktop.png");
  }

  // 4. Screenshot Kesehatan Sistem (/pengaturan) Desktop (1440px)
  console.log("4. Screenshot Kesehatan Sistem (/pengaturan) (1440px)...");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:3000/pengaturan" });
  await new Promise((r) => setTimeout(r, 2500));
  const settingsDesktop = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACT_DIR, "kesehatan_sistem_perbaikan_next_desktop.png"), Buffer.from(settingsDesktop.data, "base64"));
  console.log("   ✓ Tersimpan: kesehatan_sistem_perbaikan_next_desktop.png");

  ws.close();
  console.log("=== Seluruh screenshot berhasil disimpan di direktori artefak ===");
  process.exit(0);
}

captureScreenshots().catch((err) => {
  console.error("Gagal mengambil screenshot:", err);
  process.exit(1);
});

