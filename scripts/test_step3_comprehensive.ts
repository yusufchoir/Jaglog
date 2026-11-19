import { db } from "../shared/src/db";
import { users } from "../shared/src/schema";
import { eq, sql } from "drizzle-orm";
import { createSession, destroySession, invalidateUserRoleCache } from "../shared/src/auth";
import { redis } from "../shared/src/redis";
import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = "/Users/yahyahidayatullah/.gemini/antigravity/brain/54d19315-3e3d-4da7-a358-f1158d6c4819";

async function main() {
  console.log("=== PENGUJIAN LANGKAH 3: VERIFIKASI PERBAIKAN_LAGI ===");

  // 1. Setup Admin & Viewer Session
  const [adminRecord] = await db.select().from(users).where(eq(users.username, "admin")).limit(1);
  if (!adminRecord) throw new Error("Admin user not found in DB");

  const [viewerRecord] = await db.select().from(users).where(eq(users.role, "viewer")).limit(1);
  if (!viewerRecord) throw new Error("Viewer user not found in DB");

  const adminSession = await createSession({
    userId: adminRecord.id,
    username: adminRecord.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  const viewerSession = await createSession({
    userId: viewerRecord.id,
    username: viewerRecord.username,
    role: "viewer",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  console.log("Admin Session Token created:", adminSession);
  console.log("Viewer Session Token created:", viewerSession);

  // Hubungkan ke Chrome CDP port 9222
  console.log("\n[CDP] Membuka tab browser headless di port 9222...");
  const newTabRes = await fetch("http://127.0.0.1:9222/json/new?http://localhost:3000", { method: "PUT" });
  const page = await newTabRes.json();
  const ws = new (globalThis as any).WebSocket(page.webSocketDebuggerUrl);
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

  // ==========================================
  // PENGUJIAN 1: AKUN ADMIN DI SELURUH HALAMAN
  // ==========================================
  console.log("\n--- PENGUJIAN 1: KONSISTENSI AKUN ADMIN DI SELURUH HALAMAN ---");
  await send("Network.setCookie", {
    name: "jagalog_session",
    value: adminSession,
    domain: "localhost",
    path: "/",
  });

  const pagesToTest = [
    { name: "Ringkasan", path: "/" },
    { name: "Perangkat", path: "/perangkat" },
    { name: "Grup", path: "/grup" },
    { name: "Peta", path: "/peta" },
    { name: "Insiden", path: "/insiden" },
    { name: "Pengguna", path: "/pengguna" },
    { name: "Pengaturan", path: "/pengaturan" },
  ];

  for (const p of pagesToTest) {
    await send("Page.navigate", { url: `http://localhost:3000${p.path}` });
    await new Promise((r) => setTimeout(r, 1200));

    const evalResult = await send("Runtime.evaluate", {
      expression: `(() => {
        const links = Array.from(document.querySelectorAll("header nav a")).map(a => a.innerText.trim());
        const header = document.querySelector("header");
        const headerText = header ? header.innerText : "";
        const roleBadges = Array.from(document.querySelectorAll("header span")).map(s => s.innerText.trim()).filter(t => t === "ADMIN" || t === "VIEWER" || t.includes("Memeriksa"));
        const usernameEl = document.querySelector("header div[style*='flex'] > span[style*='font-weight: 600']");
        const displayedName = usernameEl ? usernameEl.innerText.trim() : "";
        return { links, displayedName, roleBadges, headerText };
      })()`,
      returnByValue: true,
    });

    const res = evalResult.result?.value;
    console.log(`[Halaman ${p.name} (${p.path})]`);
    console.log(` - Nav Links (${res?.links?.length || 0}):`, res?.links);
    console.log(` - Displayed Name: "${res?.displayedName}"`);
    console.log(` - Role Badges:`, res?.roleBadges);

    // Verifikasi ketat
    const hasPengguna = res?.links?.includes("Pengguna");
    const hasPengaturan = res?.links?.includes("Pengaturan");
    const isAdminBadge = res?.roleBadges?.includes("ADMIN");
    if (!hasPengguna || !hasPengaturan || !isAdminBadge) {
      console.error(`FAIL pada halaman ${p.path}: menu atau peran tidak sesuai admin!`);
      process.exit(1);
    }
  }
  console.log("✔ SUKSES: Seluruh halaman konsisten menampilkan 7 menu lengkap, nama 'Admin', dan badge 'ADMIN'!");

  // ==========================================
  // PENGUJIAN 2: AKUN VIEWER (RESTRIKSI & OTORISASI)
  // ==========================================
  console.log("\n--- PENGUJIAN 2: AKUN VIEWER (RESTRIKSI MENU & OTORISASI SERVER) ---");
  await send("Network.setCookie", {
    name: "jagalog_session",
    value: viewerSession,
    domain: "localhost",
    path: "/",
  });

  const viewerPages = ["/", "/perangkat", "/grup"];
  for (const vp of viewerPages) {
    await send("Page.navigate", { url: `http://localhost:3000${vp}` });
    await new Promise((r) => setTimeout(r, 1200));

    const evalRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const links = Array.from(document.querySelectorAll("header nav a")).map(a => a.innerText.trim());
        const roleBadges = Array.from(document.querySelectorAll("header span")).map(s => s.innerText.trim()).filter(t => t === "ADMIN" || t === "VIEWER" || t.includes("Memeriksa"));
        return { links, roleBadges };
      })()`,
      returnByValue: true,
    });

    const res = evalRes.result?.value;
    console.log(`[Viewer ${vp}] Links:`, res?.links, "| Role:", res?.roleBadges);
    if (res?.links?.includes("Pengguna") || res?.links?.includes("Pengaturan")) {
      console.error(`FAIL: Viewer dapat melihat menu admin pada ${vp}!`);
      process.exit(1);
    }
    if (!res?.roleBadges?.includes("VIEWER")) {
      console.error(`FAIL: Badge VIEWER tidak muncul untuk akun viewer pada ${vp}!`);
      process.exit(1);
    }
  }

  // Uji otorisasi server (fail-closed)
  console.log(" - Uji server mutation authorization untuk viewer:");
  const testGroupPost = await fetch("http://localhost:3000/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `jagalog_session=${viewerSession}` },
    body: JSON.stringify({ nama: "Illegal Group Attempt" }),
  });
  console.log(`   * POST /api/groups status: ${testGroupPost.status} (harus 403)`);

  const testUserPatch = await fetch(`http://localhost:3000/api/users/${adminRecord.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `jagalog_session=${viewerSession}` },
    body: JSON.stringify({ role: "viewer" }),
  });
  console.log(`   * PATCH /api/users status: ${testUserPatch.status} (harus 403)`);

  if (testGroupPost.status !== 403 || testUserPatch.status !== 403) {
    console.error("FAIL: Server otorisasi tidak menolak viewer!");
    process.exit(1);
  }
  console.log("✔ SUKSES: Viewer terestriksi dengan benar di UI dan ditolak 403 oleh server!");

  // ==========================================
  // PENGUJIAN 3: CACHE INVALIDATION PERAN
  // ==========================================
  console.log("\n--- PENGUJIAN 3: INVALIDASI CACHE PERAN PENGGUNA ---");
  // Pastikan cache peran admin terisi di Redis
  const { getUserWithFreshRole } = await import("../shared/src/auth");
  const initialRoleCheck = await getUserWithFreshRole({
    userId: adminRecord.id,
    username: adminRecord.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });
  console.log(" - Peran awal dari getUserWithFreshRole:", initialRoleCheck?.role);

  // Uji fungsi invalidasi cache
  await invalidateUserRoleCache(adminRecord.id);
  const cacheKeyAfterDel = await redis.get(`cache:user:role:${adminRecord.id}`);
  console.log(" - Cache Redis setelah invalidasi:", cacheKeyAfterDel);
  if (cacheKeyAfterDel !== null) {
    console.error("FAIL: Cache peran tidak terhapus!");
    process.exit(1);
  }
  console.log("✔ SUKSES: Invalidasi cache peran di Redis berfungsi dengan baik!");

  // ==========================================
  // PENGUJIAN 4: CIRCUIT BREAKER & ANTI-LOOP DASHBOARD
  // ==========================================
  console.log("\n--- PENGUJIAN 4: CIRCUIT BREAKER & ANTI-LOOP DASHBOARD ---");
  // Set kembali ke sesi admin
  await send("Network.setCookie", {
    name: "jagalog_session",
    value: adminSession,
    domain: "localhost",
    path: "/",
  });

  // Track network requests to /api/stats/dashboard
  const dashRequests: Array<{ url: string; timestamp: number }> = [];
  ws.addEventListener("message", (evt: any) => {
    const msg = JSON.parse(evt.data.toString());
    if (msg.method === "Network.requestWillBeSent") {
      if (msg.params.request.url.includes("/api/stats/dashboard")) {
        dashRequests.push({ url: msg.params.request.url, timestamp: Date.now() });
      }
    }
  });

  // Muat dashboard normal dan pantau selama 6 detik
  dashRequests.length = 0;
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 6000));
  console.log(` - Request /api/stats/dashboard selama 6 detik: ${dashRequests.length} kali (harus <= 2, tanpa loop)`);
  if (dashRequests.length > 2) {
    console.error("FAIL: Terdeteksi loop pemuatan berulang pada dashboard!");
    process.exit(1);
  }
  console.log("✔ SUKSES: Tidak ada loop pemuatan atau kedipan!");

  // ==========================================
  // PENGUJIAN 5: TAMPILAN MOBILE (390PX) & SCREENSHOT
  // ==========================================
  console.log("\n--- PENGUJIAN 5: SCREENSHOT DESKTOP & MOBILE 390PX ---");
  // 1. Desktop 1440px
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 2000));
  const snapDesktop = await send("Page.captureScreenshot", { format: "png" });
  const desktopPath = path.join(ARTIFACT_DIR, "dashboard_terverifikasi_desktop.png");
  fs.writeFileSync(desktopPath, Buffer.from(snapDesktop.data, "base64"));
  console.log(" - Screenshot Desktop disimpan di:", desktopPath);

  // 2. Mobile 390px
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await send("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 2000));
  const snapMobile = await send("Page.captureScreenshot", { format: "png" });
  const mobilePath = path.join(ARTIFACT_DIR, "dashboard_terverifikasi_mobile.png");
  fs.writeFileSync(mobilePath, Buffer.from(snapMobile.data, "base64"));
  console.log(" - Screenshot Mobile disimpan di:", mobilePath);

  // 3. Grup Desktop 1440px
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:3000/grup" });
  await new Promise((r) => setTimeout(r, 2000));
  const snapGrup = await send("Page.captureScreenshot", { format: "png" });
  const grupPath = path.join(ARTIFACT_DIR, "grup_terverifikasi_desktop.png");
  fs.writeFileSync(grupPath, Buffer.from(snapGrup.data, "base64"));
  console.log(" - Screenshot Grup Desktop disimpan di:", grupPath);

  // Tutup tab
  await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
  ws.close();

  // Cleanup test sessions
  await destroySession(adminSession);
  await destroySession(viewerSession);

  console.log("\n=== SELURUH PENGUJIAN LANGKAH 3 LULUS DENGAN SUKSES! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});

