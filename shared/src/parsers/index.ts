import { ParseResult } from "./types";
import { parseMikrotikLog } from "./mikrotik";
import { parseLinuxLog } from "./linux";
import { parseWindowsLog } from "./windows";
import { parseGenericLog } from "./generic";

export * from "./types";
export * from "./mikrotik";
export * from "./linux";
export * from "./windows";
export * from "./generic";

/**
 * Dispatcher utama parser log JagaLog.
 * Memilih parser terbaik berdasarkan tipe perangkat atau pola pesan log.
 */
export function parseLog(
  message: string,
  raw?: string,
  deviceType?: string,
  defaultSeverity: number = 6
): ParseResult {
  const normType = (deviceType || "").toLowerCase();
  const textToCheck = `${message || ""} ${raw || ""}`;

  // 1. Jika tipe perangkat sudah ditentukan
  if (normType === "mikrotik") {
    return parseMikrotikLog(message, defaultSeverity, raw);
  }

  if (normType === "linux") {
    return parseLinuxLog(message, defaultSeverity);
  }

  if (normType === "windows") {
    return parseWindowsLog(raw || message, defaultSeverity);
  }

  // 2. Deteksi otomatis cerdas berdasarkan isi teks
  // Windows Event JSON / NXLog / Winlogbeat
  if (
    /EventID/i.test(textToCheck) ||
    /Microsoft-Windows/i.test(textToCheck) ||
    (textToCheck.startsWith("{") && /winlog|TargetUserName|LogonType/i.test(textToCheck))
  ) {
    return parseWindowsLog(raw || message, defaultSeverity);
  }

  // MikroTik RouterOS
  if (
    /system,(?:info|error|critical|account)/i.test(textToCheck) ||
    /firewall,info/i.test(textToCheck) ||
    /login failure for user .* via (?:ssh|winbox|api|web)/i.test(textToCheck)
  ) {
    return parseMikrotikLog(message, defaultSeverity, raw);
  }

  // Linux
  if (
    /sshd|pam_unix|\[UFW\s+(?:BLOCK|ALLOW)\]|sudo:|COMMAND=|Failed password|Accepted publickey|Accepted password/i.test(
      textToCheck
    )
  ) {
    return parseLinuxLog(message, defaultSeverity);
  }

  // Fallback generic
  return parseGenericLog(message, defaultSeverity);
}
