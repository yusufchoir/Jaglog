import { ParseResult, ParsedFields, LogCategory } from "./types";

/**
 * Fallback parser untuk switch, router, firewall lain, atau format syslog generik
 * Mengekstrak informasi umum seperti IP pengirim, IP tujuan, user, aksi, dan status
 */
export function parseGenericLog(
  message: string,
  defaultSeverity: number = 6
): ParseResult {
  try {
    if (!message || typeof message !== "string") {
      return {
        severity: defaultSeverity,
        category: "other",
        sourceApp: "generic",
        parsed: { action: "unknown", outcome: "unknown", app: "generic" },
      };
    }

    const trimmed = message.trim();
    let severity = defaultSeverity;
    let category: LogCategory = "other";
    const sourceApp = "generic";

    const parsed: ParsedFields = {
      actor: null,
      src_ip: null,
      dst_ip: null,
      action: null,
      outcome: "unknown",
      app: "generic",
    };

    // 1. Ekstrak IP sumber & tujuan
    const ips = Array.from(trimmed.matchAll(/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b/g)).map((m) => m[1]);
    if (ips.length >= 1) parsed.src_ip = ips[0];
    if (ips.length >= 2) parsed.dst_ip = ips[1];

    // 2. Ekstrak User / Akun jika ada
    let actor: string | null = null;
    const specificUserMatch = trimmed.match(/(?:for user|by user|for account|user=|username=)\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i);
    if (specificUserMatch) {
      actor = specificUserMatch[1];
    } else {
      const genericUserMatch = trimmed.match(/(?:user|username|account|by)\s+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
      if (genericUserMatch && !["login", "auth", "account", "failed", "success", "system", "changed"].includes(genericUserMatch[1].toLowerCase())) {
        actor = genericUserMatch[1];
      }
    }
    parsed.actor = actor;

    // 3. Tentukan Aksi & Outcome berdasarkan kata kunci
    const lower = trimmed.toLowerCase();

    if (/fail|denied|reject|drop|block|invalid|refused|error/i.test(lower)) {
      parsed.outcome = "failure";
      if (/drop|block|reject|den/i.test(lower)) {
        parsed.action = "block";
        category = "firewall";
      } else if (/login|auth|password/i.test(lower)) {
        parsed.action = "login";
        category = "auth";
      } else {
        parsed.action = "error";
      }
      if (severity >= 6) severity = 4; // Naikkan severity ke warning jika ada indikasi gagal
    } else if (/success|accepted|permit|allow|granted|passed|logged in/i.test(lower)) {
      parsed.outcome = "success";
      if (/permit|allow/i.test(lower)) {
        parsed.action = "permit";
        category = "firewall";
      } else if (/login|auth|logged in/i.test(lower)) {
        parsed.action = "login";
        category = "auth";
      } else {
        parsed.action = "success";
      }
    } else if (/\b(?:up|down|link|interface|port|vlan|stp)\b/i.test(lower)) {
      category = "network";
      parsed.action = /\bdown\b/i.test(lower) ? "link_down" : /\bup\b/i.test(lower) ? "link_up" : "network_event";
      parsed.outcome = /\bdown\b/i.test(lower) ? "failure" : "success";
    } else if (/config|commit|saved|changed/i.test(lower)) {
      category = "config";
      parsed.action = "config_change";
    }

    // 4. Deteksi Kategori Tambahan
    if (category === "other") {
      if (/firewall|acl|packet/i.test(lower)) category = "firewall";
      else if (/login|logout|auth|session/i.test(lower)) category = "auth";
      else if (/system|cpu|memory|disk|reboot/i.test(lower)) category = "system";
      else if (/network|dhcp|dns|route|bgp|ospf/i.test(lower)) category = "network";
    }

    parsed.action = parsed.action || "log";
    return { severity, category, sourceApp, parsed };
  } catch {
    return {
      severity: defaultSeverity,
      category: "other",
      sourceApp: "generic",
      parsed: { action: "parse_error", outcome: "unknown", app: "generic" },
    };
  }
}
