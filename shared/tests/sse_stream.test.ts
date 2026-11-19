import test from "node:test";
import assert from "node:assert/strict";
import { sseBroker } from "../../app/src/lib/sse-broker";
import { directPublish, generateEventId } from "../src/events/publisher";

test("SSE Broker - Client registration, topic and device filtering", async () => {
  const receivedDev1: string[] = [];
  const receivedDev2: string[] = [];
  const receivedOnlyStatus: string[] = [];

  const client1Id = `c1_${Date.now()}`;
  const client2Id = `c2_${Date.now()}`;
  const client3Id = `c3_${Date.now()}`;

  // Client 1: filter dev-1
  sseBroker.registerClient({
    id: client1Id,
    userId: "u1",
    deviceFilter: new Set(["dev-1"]),
    topicFilter: null,
    send: (p) => receivedDev1.push(p),
    close: () => {},
    connectedAt: Date.now(),
  });

  // Client 2: filter dev-2
  sseBroker.registerClient({
    id: client2Id,
    userId: "u2",
    deviceFilter: new Set(["dev-2"]),
    topicFilter: null,
    send: (p) => receivedDev2.push(p),
    close: () => {},
    connectedAt: Date.now(),
  });

  // Client 3: filter topic "perangkat.status" only
  sseBroker.registerClient({
    id: client3Id,
    userId: "u3",
    deviceFilter: null,
    topicFilter: new Set(["perangkat.status"]),
    send: (p) => receivedOnlyStatus.push(p),
    close: () => {},
    connectedAt: Date.now(),
  });

  // Tunggu broker subscribe
  await new Promise((r) => setTimeout(r, 200));

  // 1. Publish event untuk dev-1 dengan tipe "log.baru"
  const event1Id = generateEventId();
  await directPublish({
    id: event1Id,
    tipe: "log.baru",
    perangkat_id: "dev-1",
    versi: Date.now(),
    waktu: new Date().toISOString(),
    data_ringkas: { jumlah: 5 },
  });

  // 2. Publish event untuk dev-2 dengan tipe "perangkat.status"
  const event2Id = generateEventId();
  await directPublish({
    id: event2Id,
    tipe: "perangkat.status",
    perangkat_id: "dev-2",
    versi: Date.now(),
    waktu: new Date().toISOString(),
    data_ringkas: { status_perangkat: "online" },
  });

  // Tunggu pesan pub/sub diproses
  await new Promise((r) => setTimeout(r, 300));

  // Client 1 harus menerima event1Id (dev-1) tapi TIDAK event2Id (dev-2)
  assert.ok(
    receivedDev1.some((msg) => msg.includes(event1Id)),
    "Client 1 harus menerima event dev-1"
  );
  assert.ok(
    !receivedDev1.some((msg) => msg.includes(event2Id)),
    "Client 1 TIDAK boleh menerima event dev-2"
  );

  // Client 2 harus menerima event2Id (dev-2) tapi TIDAK event1Id (dev-1)
  assert.ok(
    receivedDev2.some((msg) => msg.includes(event2Id)),
    "Client 2 harus menerima event dev-2"
  );
  assert.ok(
    !receivedDev2.some((msg) => msg.includes(event1Id)),
    "Client 2 TIDAK boleh menerima event dev-1"
  );

  // Client 3 hanya menerima event dengan tipe "perangkat.status" (event2Id)
  assert.ok(
    receivedOnlyStatus.some((msg) => msg.includes(event2Id)),
    "Client 3 harus menerima event tipe perangkat.status"
  );
  assert.ok(
    !receivedOnlyStatus.some((msg) => msg.includes(event1Id)),
    "Client 3 TIDAK boleh menerima event tipe log.baru"
  );

  // Bersihkan listener
  sseBroker.removeClient(client1Id);
  sseBroker.removeClient(client2Id);
  sseBroker.removeClient(client3Id);
});

test("SSE Broker - Connection limit enforcement (max 5 per user)", () => {
  const userId = `limit_user_${Date.now()}`;
  let closedCount = 0;

  // Daftarkan 6 koneksi untuk 1 user
  for (let i = 0; i < 6; i++) {
    sseBroker.registerClient({
      id: `conn_${userId}_${i}`,
      userId,
      deviceFilter: null,
      topicFilter: null,
      send: () => {},
      close: () => {
        closedCount++;
      },
      connectedAt: Date.now() + i * 10,
    });
  }

  // Koneksi tertua harus ditutup sehingga user tidak melebihi 5 koneksi
  assert.ok(closedCount >= 1, "Koneksi tertua harus ditutup saat melebihi batas 5 koneksi per pengguna");

  // Bersihkan
  for (let i = 0; i < 6; i++) {
    sseBroker.removeClient(`conn_${userId}_${i}`);
  }
});

test.after(async () => {
  await sseBroker.close();
  const { redis } = await import("../src/redis");
  redis.disconnect();
});


