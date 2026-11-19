import { ParseResult, ParsedFields, LogCategory } from "./types";

const KNOWN_MIKROTIK_TOPICS = new Set([
  "firewall",
  "system",
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

function isValidTopicToken(token: string): boolean {
  if (!token) return false;
  const clean = token.replace(/:$/, "").trim().toLowerCase();
  if (!/^[a-z0-9_,-]+$/.test(clean)) return false;
  if (clean.includes(",")) {
    const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.length >= 1 && parts.some((p) => KNOWN_MIKROTIK_TOPICS.has(p));
  }
  return KNOWN_MIKROTIK_TOPICS.has(clean);
}

/**
 * Mengupas header syslog (RFC 3164 / RFC 5424) atau timestamp default RouterOS v7
 * apabila pesan raw dikirimkan langsung ke parseMikrotikLog.
 */
function unwrapMikrotikHeader(input: string): {
  body: string;
  priSeverity: number | null;
} {
  let str = input.trim();
  let priSeverity: number | null = null;

  // 1. Kupas <PRI> jika ada di awal
  const priMatch = str.match(/^<(\d{1,3})>\s*/);
  if (priMatch) {
    const pri = parseInt(priMatch[1], 10);
    if (!isNaN(pri)) {
      priSeverity = pri & 7;
    }
    str = str.slice(priMatch[0].length).trim();
  }

  // 2. Kupas RFC 5424: 1 TIMESTAMP HOST APP PROCID MSGID SD MSG
  const rfc5424 = str.match(
    /^1\s+\S+\s+\S+\s+(\S+)\s+\S+\s+\S+\s+(?:\[[^\]]*\]|-)\s*(.*)$/
  );
  if (rfc5424) {
    const appName = rfc5424[1];
    const msg = (rfc5424[2] || "").trim();
    if (appName !== "-" && isValidTopicToken(appName) && !msg.startsWith(appName)) {
      return { body: `${appName} ${msg}`.trim(), priSeverity };
    }
    return { body: msg, priSeverity };
  }

  // 3. Kupas format timestamp RouterOS default: "nov/14 12:34:56 ..." atau "nov/14/2026 12:34:56 ..." atau ISO "2026-11-14 12:34:56 ..."
  const rosTimeMatch = str.match(
    /^(?:[A-Za-z]{3}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\s+(.*)$/
  );
  if (rosTimeMatch) {
    str = rosTimeMatch[1].trim();
    // Jika setelah timestamp ada hostname diikuti daftar topik (misal "SERVER181 system,info,account ...")
    const hostTopicMatch = str.match(/^(\S+)\s+([a-z0-9_,-]+(?::|\s+).*)$/i);
    if (hostTopicMatch && !isValidTopicToken(hostTopicMatch[1])) {
      const secondToken = hostTopicMatch[2].split(/[\s:]/)[0];
      if (isValidTopicToken(secondToken)) {
        str = hostTopicMatch[2].trim();
      }
    }
    return { body: str, priSeverity };
  }

  // 4. Kupas BSD Syslog timestamp: "Nov 14 12:34:56 ..."
  const bsdTimeMatch = str.match(
    /^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+(.*)$/
  );
  if (bsdTimeMatch) {
    const afterTime = bsdTimeMatch[1].trim();
    const firstTokenMatch = afterTime.match(/^(\S+)\s+(.*)$/);
    if (firstTokenMatch) {
      const firstToken = firstTokenMatch[1];
      const rest = firstTokenMatch[2].trim();
      const firstClean = firstToken.replace(/:$/, "").toLowerCase();

      // Jika token pertama langsung berupa topik MikroTik (misal "system,info,account ...")
      if (isValidTopicToken(firstClean) && firstToken.includes(",")) {
        return { body: afterTime, priSeverity };
      }

      // Jika token pertama adalah hostname (misal "MikroTik:" atau "SERVER181") dan bukan kata awal pesan
      const messageStarters = new Set(["user", "login", "forward:", "input:", "output:", "drop:", "in:"]);
      if (!messageStarters.has(firstToken.toLowerCase())) {
        return { body: rest, priSeverity };
      }
    }
    return { body: afterTime, priSeverity };
  }

  return { body: str, priSeverity };
}

/**
 * Parser khusus log perangkat MikroTik RouterOS (v6 & v7, format "default" maupun "syslog")
 * Format pesan umum:
 *  - Topics: system,error,critical,firewall,account,wireless,dhcp,ovpn,pppoe
 *  - "login failure for user admin from 203.0.113.5 via ssh"
 *  - "system,info,account user admin logged in from 192.168.88.10 via winbox"
 *  - "<134>Nov 14 12:34:56 SERVER181 system,info,account: user admin logged in from 192.168.88.10 via winbox"
 *  - "<134>Nov 14 12:34:56 SERVER181: user admin logged in from 192.168.88.10 via winbox"
 *  - "nov/14 12:34:56 system,error,critical login failure for user admin from 203.0.113.5 via ssh"
 */
export function parseMikrotikLog(
  message: string,
  defaultSeverity: number = 6,
  raw?: string
): ParseResult {
  try {
    if (!message || typeof message !== "string") {
      return {
        severity: defaultSeverity,
        category: "other",
        sourceApp: "mikrotik",
        parsed: { action: "unknown", outcome: "unknown", app: "mikrotik", topics: [] },
      };
    }

    const unwrapped = unwrapMikrotikHeader(message);
    const trimmed = unwrapped.body;
    let severity =
      defaultSeverity === 6 && unwrapped.priSeverity !== null
        ? unwrapped.priSeverity
        : defaultSeverity;
    let category: LogCategory = "system";
    let sourceApp = "mikrotik";

    const parsed: ParsedFields = {
      actor: null,
      src_ip: null,
      dst_ip: null,
      action: null,
      outcome: "unknown",
      app: "mikrotik",
      interface: null,
      topics: [],
    };

    // 1. Ekstrak prefix topics (contoh: "system,info,account", "firewall,info", "dhcp,info", dengan spasi atau titik dua)
    const topicMatch = trimmed.match(/^([a-z0-9_,-]+?)(?::\s+|\s+)(.*)$/i);
    let topics = "";
    let content = trimmed;

    if (topicMatch && isValidTopicToken(topicMatch[1])) {
      topics = topicMatch[1].toLowerCase().replace(/:$/, "");
      content = topicMatch[2].trim();
    } else if (raw && typeof raw === "string") {
      // Cek apabila topik ada di raw tetapi sudah terstrip sebelumnya
      const rawUnwrapped = unwrapMikrotikHeader(raw);
      const rawTopicMatch = rawUnwrapped.body.match(/^([a-z0-9_,-]+?)(?::\s+|\s+)(.*)$/i);
      if (rawTopicMatch && isValidTopicToken(rawTopicMatch[1])) {
        topics = rawTopicMatch[1].toLowerCase().replace(/:$/, "");
      }
    }

    const topicsArray = topics
      ? topics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    parsed.topics = topicsArray;

    // Tentukan kategori & severity berdasarkan topik
    if (topicsArray.includes("critical")) {
      severity = 2; // Critical
    } else if (topicsArray.includes("error")) {
      severity = 3; // Error
    } else if (topicsArray.includes("warning")) {
      severity = 4; // Warning
    } else if (topicsArray.includes("debug")) {
      severity = 7; // Debug
    } else if (topicsArray.includes("info")) {
      severity = 6; // Informational
    }

    if (topicsArray.includes("firewall")) {
      category = "firewall";
      sourceApp = "firewall";
    } else if (topicsArray.includes("account") || topicsArray.includes("login")) {
      category = "auth";
    } else if (
      topicsArray.includes("wireless") ||
      topicsArray.includes("dhcp") ||
      topicsArray.includes("dns") ||
      topicsArray.includes("route")
    ) {
      category = "network";
      sourceApp = topicsArray.includes("wireless")
        ? "wireless"
        : topicsArray.includes("dhcp")
        ? "dhcp"
        : "network";
    } else if (topicsArray.includes("config") || content.includes("changed configuration")) {
      category = "config";
    }

    // 2. Deteksi Pola Autentikasi / Login
    // Contoh: "login failure for user admin from 203.0.113.5 via ssh"
    // Contoh: "user admin logged in from 192.168.88.10 via winbox"
    // Contoh: "user admin logged out from 192.168.88.10 via api"
    const loginFailMatch = content.match(
      /login failure for user\s+([^\s]+)\s+from\s+([^\s]+)(?:\s+via\s+([^\s]+))?/i
    );
    if (loginFailMatch) {
      category = "auth";
      parsed.action = "login";
      parsed.outcome = "failure";
      parsed.actor = loginFailMatch[1];
      parsed.src_ip = loginFailMatch[2];
      parsed.app = loginFailMatch[3]?.toLowerCase() || "mikrotik";
      sourceApp = parsed.app;
      severity = 4; // Warning (sesuai aturan yang sudah ada)
      return { severity, category, sourceApp, parsed };
    }

    const loginSuccessMatch = content.match(
      /user\s+([^\s]+)\s+logged in\s+from\s+([^\s]+)(?:\s+via\s+([^\s]+))?/i
    );
    if (loginSuccessMatch) {
      category = "auth";
      parsed.action = "login";
      parsed.outcome = "success";
      parsed.actor = loginSuccessMatch[1];
      parsed.src_ip = loginSuccessMatch[2];
      parsed.app = loginSuccessMatch[3]?.toLowerCase() || "mikrotik";
      sourceApp = parsed.app;
      severity = 6; // Informational
      return { severity, category, sourceApp, parsed };
    }

    const logoutMatch = content.match(
      /user\s+([^\s]+)\s+logged out\s+from\s+([^\s]+)(?:\s+via\s+([^\s]+))?/i
    );
    if (logoutMatch) {
      category = "auth";
      parsed.action = "logout";
      parsed.outcome = "success";
      parsed.actor = logoutMatch[1];
      parsed.src_ip = logoutMatch[2];
      parsed.app = logoutMatch[3]?.toLowerCase() || "mikrotik";
      sourceApp = parsed.app;
      return { severity, category, sourceApp, parsed };
    }

    // 3. Deteksi Perubahan Konfigurasi
    // Contoh: "user admin changed configuration at /ip firewall filter"
    const configMatch = content.match(
      /user\s+([^\s]+)\s+changed configuration(?:\s+at\s+(.+))?/i
    );
    if (configMatch) {
      category = "config";
      parsed.action = "config_change";
      parsed.outcome = "success";
      parsed.actor = configMatch[1];
      parsed.command = configMatch[2] || null;
      severity = 5; // Notice
      return { severity, category, sourceApp, parsed };
    }

    // 4. Deteksi Firewall Forward / Drop / Input
    if (category === "firewall" || /in:[^\s]+/.test(content)) {
      category = "firewall";
      sourceApp = "firewall";

      const inMatch = content.match(/in:([^\s,]+)/);
      if (inMatch) parsed.interface = inMatch[1];

      const ipPortMatch = content.match(
        /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(?::(\d+))?->([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(?::(\d+))?/
      );
      if (ipPortMatch) {
        parsed.src_ip = ipPortMatch[1];
        parsed.dst_ip = ipPortMatch[3];
        if (ipPortMatch[2]) parsed.src_port = parseInt(ipPortMatch[2], 10);
        if (ipPortMatch[4]) parsed.dst_port = parseInt(ipPortMatch[4], 10);
      }

      if (/drop|reject|block/i.test(content) || /drop|reject|block/i.test(topics)) {
        parsed.action = "drop";
        parsed.outcome = "failure";
        severity = 4;
      } else {
        parsed.action = "forward";
        parsed.outcome = "success";
      }

      return { severity, category, sourceApp, parsed };
    }

    // 5. Deteksi DHCP
    const dhcpMatch = content.match(
      /dhcp[0-9]*\s+(assigned|deassigned)\s+([0-9.]+)\s+(?:to|from)\s+([0-9a-f:]+)/i
    );
    if (dhcpMatch) {
      category = "network";
      sourceApp = "dhcp";
      parsed.action = dhcpMatch[1].toLowerCase();
      parsed.src_ip = dhcpMatch[2];
      parsed.actor = dhcpMatch[3]; // MAC address
      parsed.outcome = "success";
      return { severity, category, sourceApp, parsed };
    }

    // 6. Deteksi Wireless
    const wlanMatch = content.match(
      /([0-9a-f:]+)@([a-z0-9]+):\s+(connected|disconnected)(?:,\s*(.+))?/i
    );
    if (wlanMatch) {
      category = "network";
      sourceApp = "wireless";
      parsed.actor = wlanMatch[1];
      parsed.interface = wlanMatch[2];
      parsed.action = wlanMatch[3].toLowerCase();
      parsed.outcome = parsed.action === "connected" ? "success" : "failure";
      parsed.reason = wlanMatch[4] || null;
      return { severity, category, sourceApp, parsed };
    }

    // 7. Deteksi System Reboot / Crash
    if (/reboot|shutdown|watchdog|kernel failure/i.test(content)) {
      category = "system";
      parsed.action = "reboot";
      parsed.outcome = /watchdog|failure|crash/i.test(content) ? "failure" : "success";
      severity = parsed.outcome === "failure" ? 2 : 5;
      return { severity, category, sourceApp, parsed };
    }

    // Fallback ekstraksi IP atau user jika ada
    const generalIp = content.match(/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b/);
    if (generalIp) parsed.src_ip = generalIp[1];

    const generalUser = content.match(/user\s+([a-zA-Z0-9_.-]+)/i);
    if (generalUser) parsed.actor = generalUser[1];

    parsed.action = parsed.action || "log";
    return { severity, category, sourceApp, parsed };
  } catch {
    // Pengaman: Jangan biarkan parser crash apapun isi stringnya
    return {
      severity: defaultSeverity,
      category: "other",
      sourceApp: "mikrotik",
      parsed: { action: "parse_error", outcome: "unknown", app: "mikrotik", topics: [] },
    };
  }
}
