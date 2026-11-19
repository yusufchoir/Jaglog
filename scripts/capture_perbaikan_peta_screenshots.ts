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

async function run() {
  console.log("Connecting to Chrome DevTools...");
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

  await pageCdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

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

  const artifactDir = "/Users/yahyahidayatullah/.gemini/antigravity/brain/54d19315-3e3d-4da7-a358-f1158d6c4819";

  console.log("Navigating to http://localhost:3000/peta...");
  await pageCdp.send("Page.navigate", { url: "http://localhost:3000/peta" });

  // Tunggu agar React Flow & nodes selesai dimuat dan auto-fitView selesai
  await new Promise((r) => setTimeout(r, 4500));

  console.log("Taking Screenshot 1: Peta Terpusat (Auto-FitView)...");
  const snap1 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file1 = path.join(artifactDir, "peta_sesudah_perbaikan_terpusat.png");
  fs.writeFileSync(file1, Buffer.from(snap1.data, "base64"));
  console.log("Saved Screenshot 1:", file1);

  // Aktifkan Mode Ubah Tata Letak
  console.log("Mengaktifkan Mode Ubah Tata Letak...");
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Ubah Tata Letak'));
      if (editBtn) editBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 1000));

  console.log("Taking Screenshot 2: Mode Ubah Tata Letak dengan Floating Toolbar...");
  const snap2 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file2 = path.join(artifactDir, "peta_mode_ubah_tata_letak.png");
  fs.writeFileSync(file2, Buffer.from(snap2.data, "base64"));
  console.log("Saved Screenshot 2:", file2);

  // Nonaktifkan Mode Ubah Tata Letak
  await pageCdp.send("Runtime.evaluate", {
    expression: `
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Selesai Ubah') || b.textContent.includes('Ubah Tata Letak'));
      if (editBtn) editBtn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 600));

  // Simulasi viewport out of range (geser react flow jauh ke luar)
  console.log("Simulasi viewport di luar jangkauan untuk memicu Banner Peringatan...");
  for (let i = 0; i < 4; i++) {
    await pageCdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 700,
      y: 400,
      button: "left",
    });
    await pageCdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 50,
      y: 50,
      button: "left",
    });
    await pageCdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 50,
      y: 50,
      button: "left",
    });
    await new Promise((r) => setTimeout(r, 200));
  }

  // Tunggu 800ms agar checkViewportVisibility mendeteksi out-of-viewport
  await new Promise((r) => setTimeout(r, 1200));

  console.log("Taking Screenshot 3: Banner Notifikasi Viewport Out-of-Range...");
  const snap3 = await pageCdp.send("Page.captureScreenshot", { format: "png" });
  const file3 = path.join(artifactDir, "peta_banner_di_luar_jangkauan.png");
  fs.writeFileSync(file3, Buffer.from(snap3.data, "base64"));
  console.log("Saved Screenshot 3:", file3);

  pageCdp.close();
  await browserCdp.send("Target.closeTarget", { targetId });
  browserCdp.close();
  console.log("Semua screenshot berhasil diambil!");
}

run().catch((e) => {
  console.error("Screenshot error:", e);
  process.exit(1);
});
