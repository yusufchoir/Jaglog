import dgram from "dgram";
import net from "net";
import { enqueueLogEvents, RawLogPayload } from "@shared/queue";
import { parseBsdSyslogTime } from "@shared/time";
import {
  recordIngestRejection,
  recordDevicePacketAccepted,
  normalizeSourceIp,
} from "@shared/ingest-diagnostics";
import {
  lookupDeviceByIp,
  lookupDeviceByName,
  checkDeviceIngestRateLimit,
} from "./cache";

const MAX_MESSAGE_SIZE = 8192; // 8 KB batas maksimal pesan
const INGEST_BATCH_SIZE = 100;
const INGEST_FLUSH_INTERVAL_MS = 50;

let pendingIngestBatch: RawLogPayload[] = [];
let ingestFlushTimeout: NodeJS.Timeout | null = null;

/**
 * Mengosongkan buffer mikro-batching dan mengirim batch sekaligus ke antrian BullMQ
 */
export async function flushSyslogBatch(): Promise<void> {
  if (ingestFlushTimeout) {
    clearTimeout(ingestFlushTimeout);
    ingestFlushTimeout = null;
  }
  if (pendingIngestBatch.length === 0) return;

  const toFlush = pendingIngestBatch;
  pendingIngestBatch = [];

  try {
    await enqueueLogEvents(toFlush);
  } catch (err) {
    console.error("[Collector Syslog Batch Error]", err);
  }
}

/**
 * Menyimpan payload log ke dalam buffer mikro-batching
 */
export function bufferSyslogPayload(payload: RawLogPayload): void {
  pendingIngestBatch.push(payload);
  if (pendingIngestBatch.length >= INGEST_BATCH_SIZE) {
    flushSyslogBatch().catch(() => {});
  } else if (!ingestFlushTimeout) {
    ingestFlushTimeout = setTimeout(() => {
      flushSyslogBatch().catch(() => {});
    }, INGEST_FLUSH_INTERVAL_MS);
  }
}

export interface ParsedSyslogHeader {
  severity: number;
  facility: number;
  timestamp: Date;
  sourceApp?: string;
  hostname?: string;
  message: string;
}

const MIKROTIK_TOPIC_SET = new Set([
  "system",
  "firewall",
  "wireless",
  "dhcp",
  "account",
  "ovpn",
  "pppoe",
  "critical",
  "error",
  "warning",
  "info",
  "debug",
  "interface",
  "route",
  "dns",
  "ipsec",
  "hotspot",
  "radius",
  "ppp",
  "l2tp",
  "sstp",
  "wireguard",
  "bgp",
  "ospf",
  "script",
  "watchdog",
  "health",
]);

function isMikrotikTopicToken(token: string | undefined): boolean {
  if (!token) return false;
  const cleaned = token.replace(/:$/, "").toLowerCase();
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.length >= 1 && parts.some((p) => MIKROTIK_TOPIC_SET.has(p));
  }
  return MIKROTIK_TOPIC_SET.has(cleaned);
}

/**
 * Parse header syslog RFC 3164 / RFC 5424 / RouterOS v7
 */
export function parseSyslogMessage(raw: string, timezone: string = "Asia/Jakarta"): ParsedSyslogHeader {
  let pri = 14; // Default: facility 1 (user), severity 6 (info) -> 1*8 + 6 = 14
  let content = raw.trim();

  // 1. Ekstrak Priority <PRI>
  const priMatch = content.match(/^<(\d{1,3})>/);
  if (priMatch) {
    pri = parseInt(priMatch[1], 10);
    content = content.slice(priMatch[0].length).trim();
  }

  const severity = pri & 7;
  const facility = pri >> 3;

  // 2. Cek RFC 5424: <PRI>1 TIMESTAMP HOST APP-NAME PROCID MSGID STRUCTURED-DATA MSG
  const rfc5424Match = content.match(
    /^1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:\[[^\]]*\]|-)\s*(.*)$/
  );

  if (rfc5424Match) {
    const [, timeStr, hostName, appName, , , msg] = rfc5424Match;
    let parsedDate = new Date(timeStr);
    if (isNaN(parsedDate.getTime())) {
      parsedDate = new Date();
    }
    const cleanApp = appName !== "-" ? appName : undefined;
    // Bila appName adalah daftar topik MikroTik, pertahankan di awal message agar parseMikrotikLog dapat mengekstrak parsed.topics
    const finalMsg =
      cleanApp && isMikrotikTopicToken(cleanApp) && !(msg || "").startsWith(cleanApp)
        ? `${cleanApp} ${msg || ""}`.trim()
        : msg || "";
    return {
      severity,
      facility,
      timestamp: parsedDate,
      hostname: hostName !== "-" ? hostName : undefined,
      sourceApp: cleanApp ? cleanApp.split(",")[0] : undefined,
      message: finalMsg,
    };
  }

  // 3. Cek RFC 3164 (BSD) dengan titik dua: Mmm dd hh:mm:ss HOST APP[PID]: MSG
  const rfc3164Match = content.match(
    /^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:\[\s]+)?(?:\S*)?:\s*(.*)$/
  );

  if (rfc3164Match) {
    const [, timeStr, hostName, appName, msg] = rfc3164Match;
    let parsedDate = parseBsdSyslogTime(timeStr, timezone);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      parsedDate = new Date();
    }
    // Jika hostName sebenarnya adalah daftar topik MikroTik (tanpa hostname di paket)
    if (isMikrotikTopicToken(hostName) && !appName) {
      return {
        severity,
        facility,
        timestamp: parsedDate,
        sourceApp: hostName.split(",")[0],
        message: `${hostName}: ${msg}`.trim(),
      };
    }
    // Jika appName adalah daftar topik MikroTik dengan koma (misal "system,info,account"), sertakan di message
    // Untuk tag tunggal seperti "system:", parsed.sourceApp sudah menampungnya dan parseMikrotikLog membacanya dari sourceApp
    const finalMsg =
      appName && appName.includes(",") && isMikrotikTopicToken(appName)
        ? `${appName}: ${msg}`.trim()
        : msg;
    return {
      severity,
      facility,
      timestamp: parsedDate,
      hostname: hostName,
      sourceApp: appName || undefined,
      message: finalMsg,
    };
  }

  // 4. Cek BSD / RouterOS tanpa titik dua: Mmm dd hh:mm:ss HOST topics message
  const bsdNoColonMatch = content.match(
    /^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/
  );
  if (bsdNoColonMatch) {
    const [, timeStr, firstToken, restMsg] = bsdNoColonMatch;
    let parsedDate = parseBsdSyslogTime(timeStr, timezone);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      parsedDate = new Date();
    }
    if (isMikrotikTopicToken(firstToken)) {
      return {
        severity,
        facility,
        timestamp: parsedDate,
        sourceApp: firstToken.split(",")[0],
        message: `${firstToken} ${restMsg}`.trim(),
      };
    }
    return {
      severity,
      facility,
      timestamp: parsedDate,
      hostname: firstToken,
      message: restMsg.trim(),
    };
  }

  // Fallback: Seluruh isi adalah message
  return {
    severity,
    facility,
    timestamp: new Date(),
    message: content,
  };
}

/**
 * Handler pemrosesan pesan syslog tunggal
 */
export async function processRawSyslog(rawText: string, clientIp: string): Promise<boolean> {
  const cleanIp = normalizeSourceIp(clientIp);

  // Cari perangkat berdasarkan IP pengirim terlebih dahulu
  let device = await lookupDeviceByIp(cleanIp);

  // 1. Cek format terbaca / kosong
  if (
    typeof rawText !== "string" ||
    rawText.replace(/\0/g, "").trim().length === 0 ||
    !/[\x20-\x7E\u00A0-\uFFFF]/.test(rawText)
  ) {
    await recordIngestRejection({
      reason: "tidak_terbaca",
      deviceId: device?.id || null,
      sourceIp: cleanIp,
      transport: "syslog",
    });
    return false;
  }

  // 2. Cek batas ukuran maksimal 8 KB
  if (Buffer.byteLength(rawText, "utf-8") > MAX_MESSAGE_SIZE) {
    await recordIngestRejection({
      reason: "ukuran",
      deviceId: device?.id || null,
      sourceIp: cleanIp,
      transport: "syslog",
    });
    return false;
  }

  // Parse awal untuk identifikasi hostname
  const initialParsed = parseSyslogMessage(rawText);

  // Jika dikirim dari loopback lokal dan hostname berisi IP perangkat terdaftar
  if (!device && (cleanIp === "127.0.0.1" || cleanIp === "::1") && initialParsed.hostname) {
    device = await lookupDeviceByIp(initialParsed.hostname);
  }

  // 3. Jika IP pengirim tidak cocok dengan perangkat mana pun:
  if (!device) {
    // Cek apakah hostname cocok dengan nama perangkat yang belum punya IP (untuk diagnostik Event Log perangkat tsb)
    const matchedByName = initialParsed.hostname
      ? await lookupDeviceByName(initialParsed.hostname)
      : null;

    await recordIngestRejection({
      reason: "ip_tidak_terdaftar",
      deviceId: matchedByName && !matchedByName.ipAddress ? matchedByName.id : null,
      sourceIp: cleanIp,
      transport: "syslog",
    });
    return false;
  }

  // 4. Cek apakah perangkat sedang Nonaktif
  if (!device.isActive) {
    await recordIngestRejection({
      reason: "nonaktif",
      deviceId: device.id,
      sourceIp: cleanIp,
      transport: "syslog",
    });
    return false;
  }

  // 5. Cek Rate Limit per perangkat (2000 pesan/detik)
  const isAllowed = await checkDeviceIngestRateLimit(device.id);
  if (!isAllowed) {
    await recordIngestRejection({
      reason: "rate_limit",
      deviceId: device.id,
      sourceIp: cleanIp,
      transport: "syslog",
    });
    return false;
  }

  // 6. Catat waktu paket terakhir yang berhasil diterima
  recordDevicePacketAccepted(device.id, cleanIp, "syslog").catch(() => {});

  // Parse ulang dengan timezone perangkat terdaftar jika ada
  const deviceTz = device.timezone || "Asia/Jakarta";
  const parsed = parseSyslogMessage(rawText, deviceTz);

  const payload: RawLogPayload = {
    deviceId: device.id,
    raw: rawText,
    receivedAt: new Date().toISOString(),
    eventTime: parsed.timestamp.toISOString(),
    sourceIp: cleanIp,
    severity: parsed.severity,
    facility: parsed.facility,
    sourceApp: parsed.sourceApp,
    message: parsed.message,
    category: "other",
    deviceType: device.type,
  };

  // 7. Masukkan ke buffer mikro-batching
  bufferSyslogPayload(payload);
  return true;
}

let lastLogTime = 0;

/**
 * Jalankan UDP Syslog Listener
 */
export function startUdpSyslogServer(port: number): dgram.Socket {
  const server = dgram.createSocket("udp4");

  server.on("message", async (msg, rinfo) => {
    try {
      const rawText = msg.toString("utf-8");
      const ok = await processRawSyslog(rawText, rinfo.address);
      const now = Date.now();
      if (now - lastLogTime > 1000) {
        lastLogTime = now;
        if (ok) {
          console.log(`[Syslog UDP] Paket (${msg.length} bytes) dari ${rinfo.address}:${rinfo.port} berhasil diproses.`);
        } else {
          console.warn(`[Syslog UDP] Paket (${msg.length} bytes) dari ${rinfo.address}:${rinfo.port} ditolak.`);
        }
      }
    } catch (err) {
      console.error("[UDP Syslog Error]", err);
    }
  });

  server.on("error", (err) => {
    console.error("[UDP Syslog Server Error]", err);
  });

  server.bind(port, () => {
    console.log(`[Collector] Syslog UDP Server mendengarkan di port ${port}`);
  });

  return server;
}

/**
 * Jalankan TCP Syslog Listener (mendukung Newline framing & Octet-counting)
 */
export function startTcpSyslogServer(port: number): net.Server {
  const server = net.createServer((socket) => {
    const clientIp = socket.remoteAddress || "127.0.0.1";
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf-8");

      // Loop memproses frame TCP
      while (buffer.length > 0) {
        // A. Cek Octet-counting framing: "<length> <message>"
        const octetMatch = buffer.match(/^(\d+)\s/);
        if (octetMatch) {
          const msgLen = parseInt(octetMatch[1], 10);
          const headerLen = octetMatch[0].length;
          const totalFrameLen = headerLen + msgLen;

          if (buffer.length >= totalFrameLen) {
            const rawMsg = buffer.slice(headerLen, totalFrameLen);
            buffer = buffer.slice(totalFrameLen);
            await processRawSyslog(rawMsg, clientIp);
            continue;
          } else {
            // Belum cukup data dalam buffer, tunggu chunk berikutnya
            break;
          }
        }

        // B. Cek Newline framing: "<message>\n"
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const rawMsg = buffer.slice(0, newlineIdx).replace(/\r$/, "");
          buffer = buffer.slice(newlineIdx + 1);
          if (rawMsg.trim()) {
            await processRawSyslog(rawMsg, clientIp);
          }
          continue;
        }

        // Jika tidak ada newline dan buffer terlalu panjang (> 16 KB), reset buffer untuk cegah memory leak
        if (buffer.length > 16384) {
          buffer = "";
        }
        break;
      }
    });

    socket.on("error", () => {
      // Client disconnect biasa
    });
  });

  server.on("error", (err) => {
    console.error("[TCP Syslog Server Error]", err);
  });

  server.listen(port, () => {
    console.log(`[Collector] Syslog TCP Server mendengarkan di port ${port}`);
  });

  return server;
}
