import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  publishChange,
  directPublish,
  getEventsSince,
  CHANGES_CHANNEL,
  generateEventId,
} from "../src/events/publisher";
import { redis } from "../src/redis";

after(() => {
  redis.disconnect();
});

test("SSE Publisher - Event generation and direct publishing", async () => {
  const sub = redis.duplicate();
  await sub.connect().catch(() => {}); // If not already connected

  let receivedMessage: string | null = null;
  await sub.subscribe(CHANGES_CHANNEL);
  sub.on("message", (channel, message) => {
    if (channel === CHANGES_CHANNEL) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.id === testId) {
          receivedMessage = message;
        }
      } catch {}
    }
  });

  const testId = generateEventId();
  await directPublish({
    id: testId,
    tipe: "perangkat.status",
    perangkat_id: "dev-test-1",
    versi: Date.now(),
    waktu: new Date().toISOString(),
    data_ringkas: { status_perangkat: "online", ping_ok: true },
  });

  // Tunggu pesan pub/sub diterima
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(receivedMessage, "Pesan pub/sub harus diterima oleh subscriber");
  const parsed = JSON.parse(receivedMessage);
  assert.equal(parsed.id, testId);
  assert.equal(parsed.tipe, "perangkat.status");
  assert.equal(parsed.perangkat_id, "dev-test-1");
  assert.equal(parsed.data_ringkas?.status_perangkat, "online");

  // Periksa Last-Event-ID buffer
  const eventsSince = await getEventsSince(null);
  assert.ok(eventsSince.length > 0, "Buffer harus menyimpan event terbaru");
  const found = eventsSince.find((e) => e.id === testId);
  assert.ok(found, "Event yang baru saja dipublish harus ada di recent events buffer");

  await sub.unsubscribe(CHANGES_CHANNEL);
  sub.disconnect();
});

test("SSE Publisher - Coalescing log.baru bursts", async () => {
  const deviceId = `dev-burst-test-${Date.now()}`;
  const startId = 100;

  // Kirim 50 event log.baru dalam sekejap
  for (let i = 0; i < 50; i++) {
    await publishChange({
      tipe: "log.baru",
      perangkat_id: deviceId,
      data_ringkas: {
        id_log_terakhir: startId + i,
        jumlah: 1,
      },
    });
  }

  // Tunggu window coalescing selesai (1.2 detik)
  await new Promise((resolve) => setTimeout(resolve, 1400));

  // Ambil recent events
  const recent = await getEventsSince(null);
  const deviceEvents = recent.filter(
    (e) => e.perangkat_id === deviceId && e.tipe === "log.baru"
  );

  // Harus di-coalesce menjadi 1 event saja dengan jumlah = 50 dan id_log_terakhir = 149
  assert.equal(deviceEvents.length, 1, "50 event log.baru dalam 1 detik harus di-coalesce menjadi 1 event");
  assert.equal(deviceEvents[0].data_ringkas?.jumlah, 50, "Jumlah log harus terakumulasi menjadi 50");
  assert.equal(deviceEvents[0].data_ringkas?.id_log_terakhir, 149, "id_log_terakhir harus yang terbesar (149)");
});
