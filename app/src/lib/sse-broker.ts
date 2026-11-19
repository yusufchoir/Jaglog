import Redis from "ioredis";
import { redis } from "@shared/redis";
import { CHANGES_CHANNEL, ChangeEvent } from "@shared/events/publisher";

export interface SSEClient {
  id: string;
  userId: string;
  deviceFilter: Set<string> | null; // null means all devices
  topicFilter: Set<string> | null; // null means all topics
  send: (payload: string) => void;
  close: () => void;
  connectedAt: number;
}

class SSEBroker {
  private clients = new Map<string, SSEClient>();
  private subscriber: Redis | null = null;
  private isSubscribed = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly MAX_TOTAL_CONNECTIONS = 200;
  private readonly MAX_PER_USER_CONNECTIONS = 5;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      const pingFrame = ": ping\n\n";
      for (const client of this.clients.values()) {
        try {
          client.send(pingFrame);
        } catch {
          // Client might have disconnected
        }
      }
    }, 20000); // Heartbeat setiap 20 detik
    if (this.heartbeatInterval && typeof this.heartbeatInterval.unref === "function") {
      this.heartbeatInterval.unref();
    }
  }

  private ensureSubscriber() {
    if (this.subscriber) return;

    this.subscriber = redis.duplicate();
    this.subscriber.subscribe(CHANGES_CHANNEL, (err) => {
      if (err) {
        console.error("[SSEBroker] Gagal subscribe ke Redis pub/sub:", err);
      } else {
        this.isSubscribed = true;
      }
    });

    this.subscriber.on("message", (channel, message) => {
      if (channel !== CHANGES_CHANNEL) return;
      this.broadcastMessage(message);
    });

    this.subscriber.on("error", (err) => {
      console.error("[SSEBroker] Redis subscriber error:", err);
    });
  }

  private broadcastMessage(rawMessage: string) {
    try {
      const event = JSON.parse(rawMessage) as ChangeEvent;
      const frame = `id: ${event.id}\nevent: ${event.tipe}\ndata: ${rawMessage}\n\n`;

      for (const client of this.clients.values()) {
        // Filter topik jika ditentukan
        if (client.topicFilter && !client.topicFilter.has(event.tipe)) {
          continue;
        }

        // Filter perangkat jika ditentukan
        if (
          client.deviceFilter &&
          event.perangkat_id &&
          !client.deviceFilter.has(event.perangkat_id)
        ) {
          continue;
        }

        try {
          client.send(frame);
        } catch (e) {
          console.warn("[SSEBroker] Gagal mengirim ke client, menutup:", client.id);
          this.removeClient(client.id);
        }
      }
    } catch (e) {
      console.error("[SSEBroker] Gagal parsing pesan Redis broadcast:", e);
    }
  }

  public registerClient(client: SSEClient): { ok: boolean; reason?: string } {
    this.ensureSubscriber();

    // 1. Periksa batas total koneksi per instance (200)
    if (this.clients.size >= this.MAX_TOTAL_CONNECTIONS) {
      // Cari dan tutup koneksi tertua
      let oldest: SSEClient | null = null;
      for (const c of this.clients.values()) {
        if (!oldest || c.connectedAt < oldest.connectedAt) {
          oldest = c;
        }
      }
      if (oldest) {
        oldest.close();
        this.clients.delete(oldest.id);
      }
    }

    // 2. Periksa batas koneksi per user (maks 5)
    const userClients: SSEClient[] = [];
    for (const c of this.clients.values()) {
      if (c.userId === client.userId) {
        userClients.push(c);
      }
    }

    if (userClients.length >= this.MAX_PER_USER_CONNECTIONS) {
      // Tutup koneksi tertua milik user ini
      userClients.sort((a, b) => a.connectedAt - b.connectedAt);
      const oldestUserClient = userClients[0];
      try {
        oldestUserClient.close();
      } catch {}
      this.clients.delete(oldestUserClient.id);
    }

    this.clients.set(client.id, client);
    return { ok: true };
  }

  public removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
    }
  }

  public getActiveConnectionCount(): number {
    return this.clients.size;
  }

  public async close() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
      this.isSubscribed = false;
    }
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {}
    }
    this.clients.clear();
  }
}

// Singleton global untuk broker SSE di runtime proses app
const globalForSSE = global as unknown as { sseBroker?: SSEBroker };
export const sseBroker = globalForSSE.sseBroker || new SSEBroker();
if (process.env.NODE_ENV !== "production") {
  globalForSSE.sseBroker = sseBroker;
}
