import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";
import fs from "fs";
import path from "path";

class CDPClient {
  private ws!: WebSocket;
  private idCounter = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

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

async function capture() {
  console.log("Menghubungkan ke Chrome DevTools Protocol...");
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

  // Set window viewport
  await pageCdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  // Ambil user admin
  const [adminUser] = (await db.execute(sql`SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`)) as any;
  const token = await createSession({
    userId: adminUser.id,
    username: adminUser.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  // Set Cookie
  await pageCdp.send("Network.setCookie", {
    name: "jagalog_session",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });

  const screenshotsDir = path.resolve(__dirname, "../screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  console.log("Membuka http://localhost:3000/peta...");
  await pageCdp.send("Page.navigate", { url: "http://localhost:3000/peta" });

  // Tunggu 4 detik agar React Flow & nodes selesai dimuat
  await new Promise((r) => setTimeout(r, 4000));

  // Screenshot 1: Expanded state
  console.log("Mengambil screenshot 1 (Peta Grup Terbuka / Expanded)...");
  const snap1 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file1 = path.join(screenshotsDir, "1_peta_grup_terbuka.png");
  fs.writeFileSync(file1, Buffer.from(snap1.data, "base64"));
  console.log("Tersimpan:", file1);

  // Cari tombol Lipat dan klik
  console.log("Mencari tombol Lipat pada grup...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const buttons = Array.from(document.querySelectorAll('button'));
      const lipatBtn = buttons.find(b => b.textContent && b.textContent.includes('Lipat'));
      if (lipatBtn) {
        lipatBtn.click();
      }
    `,
  });

  // Tunggu 1 detik
  await new Promise((r) => setTimeout(r, 1500));

  // Screenshot 2: Collapsed state
  console.log("Mengambil screenshot 2 (Peta Grup Terlipat / Collapsed)...");
  const snap2 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file2 = path.join(screenshotsDir, "2_peta_grup_terlipat.png");
  fs.writeFileSync(file2, Buffer.from(snap2.data, "base64"));
  console.log("Tersimpan:", file2);

  // Reload halaman untuk menguji persistensi
  console.log("Merefresh halaman (Page.reload) untuk menguji persistensi...");
  await pageCdp.send("Page.reload", { ignoreCache: true });

  // Tunggu 3.5 detik
  await new Promise((r) => setTimeout(r, 3500));

  // Screenshot 3: After Refresh state
  console.log("Mengambil screenshot 3 (Setelah Refresh - status lipat tetap tersimpan)...");
  const snap3 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file3 = path.join(screenshotsDir, "3_peta_setelah_refresh.png");
  fs.writeFileSync(file3, Buffer.from(snap3.data, "base64"));
  console.log("Tersimpan:", file3);

  pageCdp.close();
  await browserCdp.send("Target.closeTarget", { targetId });
  browserCdp.close();

  console.log("\nSemua screenshot berhasil diambil!");
}

capture()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Gagal capture:", e);
    process.exit(1);
  });

