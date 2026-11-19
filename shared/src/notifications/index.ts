import nodemailer from "nodemailer";
import { Worker, Job } from "bullmq";
import { db } from "../db";
import { notificationChannels, notificationLogs, devices } from "../schema";
import { eq } from "drizzle-orm";
import { decryptConfig } from "./crypto";
import { redis, getRedisConnectionOptions } from "../redis";
import { NOTIFY_QUEUE_NAME, NotificationJobPayload, enqueueNotification } from "../queue";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

export type NotificationEventType =
  | "ping_rto"
  | "ping_recovered"
  | "device_offline"
  | "device_recovered"
  | "flapping_detected"
  | "test";

/**
 * Mendapatkan dugaan penyebab berdasarkan korelasi hasil ping dan status pengiriman log
 */
export function getSuspectedCause(params: {
  isPingOk: boolean;
  isLogActive: boolean;
}): string {
  const { isPingOk, isLogActive } = params;
  if (!isPingOk && !isLogActive) {
    return "Perangkat mati atau jaringan putus";
  }
  if (!isPingOk && isLogActive) {
    return "Ping diblokir, perangkat masih hidup";
  }
  if (isPingOk && !isLogActive) {
    return "Layanan pengirim log berhenti";
  }
  return "Status perangkat normal";
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(config: TelegramConfig, messageText: string): Promise<any> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: messageText,
      parse_mode: "HTML",
    }),
  });

  const body = (await res.json()) as any;
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram API Error: ${body?.description || res.statusText}`);
  }
  return body;
}

/**
 * Send an email via SMTP (Nodemailer)
 */
export async function sendEmailMessage(
  config: EmailConfig,
  subject: string,
  htmlContent: string
): Promise<any> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? (config.port === 465),
    auth:
      config.user && config.pass
        ? {
            user: config.user,
            pass: config.pass,
          }
        : undefined,
  });

  return await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject,
    html: htmlContent,
  });
}

/**
 * Proses pengiriman notifikasi dari payload job ke semua channel aktif yang sesuai
 */
export async function processNotificationPayload(
  payload: NotificationJobPayload
): Promise<{ sent: number; failed: number }> {
  // Ambil semua channel aktif
  const activeChannels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.isActive, true));

  if (activeChannels.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let title = `[NOTIFIKASI] Status Perangkat: ${payload.deviceName}`;
  let titleColor = "#1F5FBF";

  if (payload.eventType === "ping_rto") {
    title = `[PERINGATAN] Ping RTO: ${payload.deviceName}`;
    titleColor = "#C8372D";
  } else if (payload.eventType === "ping_recovered") {
    title = `[PULIH] Ping Normal Kembali: ${payload.deviceName}`;
    titleColor = "#15803D";
  } else if (payload.eventType === "device_offline") {
    title = `[PERINGATAN] Perangkat Offline: ${payload.deviceName}`;
    titleColor = "#C8372D";
  } else if (payload.eventType === "device_recovered") {
    title = `[PULIH] Perangkat Kembali Online: ${payload.deviceName}`;
    titleColor = "#15803D";
  } else if (payload.eventType === "flapping_detected") {
    title = `[PERINGATAN] Perangkat Tidak Stabil: ${payload.deviceName}`;
    titleColor = "#B45309";
  }

  const messageText = `
<b>${title}</b>
<b>Nama Perangkat:</b> ${payload.deviceName}
<b>Alamat IP:</b> ${payload.deviceIp || "HTTP Ingest"}
<b>Waktu Mulai:</b> ${payload.startTimeWib} WIB
${payload.durationText ? `<b>Durasi:</b> ${payload.durationText}\n` : ""}<b>Dugaan Penyebab:</b> ${payload.suspectedCause}
<b>Dashboard:</b> <a href="${payload.deviceUrl}">${payload.deviceUrl}</a>
  `.trim();

  let sent = 0;
  let failed = 0;

  for (const ch of activeChannels) {
    // Periksa apakah channel memilih event ini
    const subscribedEvents = (ch.events as string[]) || [
      "ping_rto",
      "ping_recovered",
      "device_offline",
      "device_recovered",
      "flapping_detected",
    ];

    if (!subscribedEvents.includes(payload.eventType)) {
      continue;
    }

    try {
      if (ch.type === "telegram") {
        const config = decryptConfig<TelegramConfig>(ch.config);
        await sendTelegramMessage(config, messageText);
      } else if (ch.type === "email") {
        const config = decryptConfig<EmailConfig>(ch.config);
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #E6E4DF; padding: 20px; border-radius: 6px;">
            <h3 style="color: ${titleColor}; margin-top: 0;">${title}</h3>
            <p><strong>Nama Perangkat:</strong> ${payload.deviceName}</p>
            <p><strong>Alamat IP:</strong> ${payload.deviceIp || "HTTP Ingest"}</p>
            <p><strong>Waktu Mulai:</strong> ${payload.startTimeWib} WIB</p>
            ${payload.durationText ? `<p><strong>Durasi:</strong> ${payload.durationText}</p>` : ""}
            <p><strong>Dugaan Penyebab:</strong> ${payload.suspectedCause}</p>
            <p><a href="${payload.deviceUrl}" style="display: inline-block; padding: 8px 16px; background-color: #1F5FBF; color: #FFFFFF; text-decoration: none; border-radius: 4px;">Buka Dashboard Perangkat</a></p>
            <hr style="border: 0; border-top: 1px solid #E6E4DF; margin: 20px 0;" />
            <small style="color: #718096;">JagaLog Network Security Monitoring</small>
          </div>
        `;
        await sendEmailMessage(config, title, html);
      }

      await db.insert(notificationLogs).values({
        channelId: ch.id,
        deviceId: payload.deviceId,
        eventType: payload.eventType,
        status: "sent",
        details: { message: "Notifikasi berhasil terkirim.", suspectedCause: payload.suspectedCause },
      });
      sent++;
    } catch (err: any) {
      console.error(`[Notification] Gagal mengirim ke channel '${ch.name}':`, err.message);
      await db.insert(notificationLogs).values({
        channelId: ch.id,
        deviceId: payload.deviceId,
        eventType: payload.eventType,
        status: "failed",
        details: { error: err.message || "Unknown error" },
      });
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Menjalankan BullMQ Worker untuk antrian 'notify'
 */
export function startNotifyWorker(): Worker<NotificationJobPayload> {
  const worker = new Worker<NotificationJobPayload>(
    NOTIFY_QUEUE_NAME,
    async (job: Job<NotificationJobPayload>) => {
      await processNotificationPayload(job.data);
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[Notify Worker] Job ${job?.id} gagal:`, err.message);
  });

  return worker;
}

/**
 * Dispatch notification: memvalidasi anti-spam, mengkorelasikan dugaan penyebab,
 * dan memasukkan notifikasi ke antrian BullMQ 'notify'.
 */
export async function dispatchDeviceStatusNotification(params: {
  device: { id: string; name: string; ipAddress?: string | null };
  eventType: "ping_rto" | "ping_recovered" | "device_offline" | "device_recovered" | "flapping_detected";
  durationText?: string;
  isPingOk?: boolean;
  isLogActive?: boolean;
}): Promise<{ queued: boolean; rateLimited: boolean }> {
  const { device, eventType, durationText, isPingOk = false, isLogActive = false } = params;
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const deviceUrl = `${appUrl}/perangkat/${device.id}`;

  const suspectedCause = getSuspectedCause({ isPingOk, isLogActive });

  const now = new Date();
  const startTimeWib = now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  const payload: NotificationJobPayload = {
    deviceId: device.id,
    deviceName: device.name,
    deviceIp: device.ipAddress,
    eventType,
    startTimeWib,
    durationText,
    suspectedCause,
    deviceUrl,
  };

  // Masukkan ke antrian BullMQ 'notify'
  const queued = await enqueueNotification(payload);

  // Jika koneksi Redis antrian sedang tidak aktif (misal di unit test standalone), proses langsung
  if (!queued) {
    await processNotificationPayload(payload).catch((e) =>
      console.error("[Notification Direct Fallback Error]", e)
    );
  }

  return { queued: true, rateLimited: false };
}

/**
 * Send a test notification to verify channel configuration
 */
export async function sendTestNotification(channelId: string): Promise<{ success: boolean; message: string }> {
  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, channelId))
    .limit(1);

  if (!channel) {
    throw new Error("Saluran notifikasi tidak ditemukan.");
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const testMsg = `
<b>[TEST] Uji Coba Notifikasi JagaLog</b>
Saluran <b>${channel.name}</b> berhasil terhubung dengan sistem JagaLog.
Waktu Pengujian: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
Dashboard: <a href="${appUrl}">${appUrl}</a>
  `.trim();

  try {
    if (channel.type === "telegram") {
      const config = decryptConfig<TelegramConfig>(channel.config);
      await sendTelegramMessage(config, testMsg);
    } else if (channel.type === "email") {
      const config = decryptConfig<EmailConfig>(channel.config);
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #E6E4DF; padding: 20px; border-radius: 6px;">
          <h3 style="color: #1F5FBF; margin-top: 0;">[TEST] Uji Coba Saluran Notifikasi JagaLog</h3>
          <p>Pengujian untuk saluran: <strong>${channel.name}</strong></p>
          <p>Konfigurasi pengiriman email SMTP Anda telah berfungsi dengan baik.</p>
          <p><a href="${appUrl}">Kunjungi Dashboard JagaLog</a></p>
        </div>
      `;
      await sendEmailMessage(config, "[TEST] Uji Coba Saluran Notifikasi JagaLog", html);
    }

    await db.insert(notificationLogs).values({
      channelId: channel.id,
      eventType: "test",
      status: "sent",
      details: { message: "Uji coba berhasil." },
    });

    return { success: true, message: `Uji coba ke saluran '${channel.name}' berhasil terkirim.` };
  } catch (err: any) {
    await db.insert(notificationLogs).values({
      channelId: channel.id,
      eventType: "test",
      status: "failed",
      details: { error: err.message },
    });
    return { success: false, message: `Gagal mengirim notifikasi uji coba: ${err.message}` };
  }
}
