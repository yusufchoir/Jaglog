import { ParseResult, ParsedFields, LogCategory } from "./types";

/**
 * Parser khusus log sistem Windows (menerima format JSON NXLog, Winlogbeat, atau teks EventID)
 * EventID penting yang dipetakan:
 *  - 4624: Logon Berhasil (User, IP, LogonType)
 *  - 4625: Logon Gagal (User, IP, Status)
 *  - 4634: Logoff
 *  - 4648: Logon dengan kredensial eksplisit (RunAs)
 *  - 4672: Hak istimewa khusus diberikan ke sesi baru (Admin)
 *  - 4720: Akun pengguna baru dibuat
 *  - 4722: Akun pengguna diaktifkan
 *  - 4724: Percobaan reset password akun
 *  - 4726: Akun pengguna dihapus
 *  - 4732: Anggota ditambahkan ke grup keamanan lokal (cth: Administrators)
 *  - 4740: Akun pengguna terkunci (Locked Out)
 *  - 1102: Log audit keamanan dibersihkan (Audit Log Cleared)
 *  - 7045: Service baru dipasang pada sistem
 */
export function parseWindowsLog(
  input: string | Record<string, unknown>,
  defaultSeverity: number = 6
): ParseResult {
  try {
    let rawObj: Record<string, unknown> = {};
    let textRepresentation = "";

    // 1. Ekstrak data dari input (bisa string JSON, object, atau teks biasa)
    if (typeof input === "object" && input !== null) {
      rawObj = input;
      textRepresentation = JSON.stringify(input);
    } else if (typeof input === "string") {
      textRepresentation = input.trim();
      if (textRepresentation.startsWith("{") && textRepresentation.endsWith("}")) {
        try {
          rawObj = JSON.parse(textRepresentation);
        } catch {
          // Bukan JSON valid, lanjut sebagai teks biasa
        }
      }
    }

    // Normalisasi struktur bertingkat Winlogbeat (winlog.event_data) vs NXLog (flat)
    const winlog = (rawObj.winlog as Record<string, unknown>) || {};
    const eventData =
      (rawObj.EventData as Record<string, unknown>) ||
      (winlog.event_data as Record<string, unknown>) ||
      rawObj;

    // Cari EventID
    let eventId: number | null = null;
    if (rawObj.EventID !== undefined) {
      eventId = parseInt(String(rawObj.EventID), 10);
    } else if (winlog.event_id !== undefined) {
      eventId = parseInt(String(winlog.event_id), 10);
    } else if (eventData.EventID !== undefined) {
      eventId = parseInt(String(eventData.EventID), 10);
    } else {
      // Coba regex cari EventID pada teks: "EventID=4625" atau "[4625]" atau "Event ID: 4625"
      const evMatch = textRepresentation.match(/(?:EventID|Event ID|EventId)[=:\s]+(\d+)|\[(\d{4})\]/i);
      if (evMatch) {
        eventId = parseInt(evMatch[1] || evMatch[2], 10);
      }
    }

    // Cari fields umum
    const actor =
      (eventData.TargetUserName as string) ||
      (eventData.SubjectUserName as string) ||
      (eventData.AccountName as string) ||
      (rawObj.AccountName as string) ||
      (rawObj.TargetUserName as string) ||
      null;

    const srcIp =
      (eventData.IpAddress as string) ||
      (eventData.SourceNetworkAddress as string) ||
      (rawObj.IpAddress as string) ||
      null;

    const logonType =
      eventData.LogonType !== undefined
        ? eventData.LogonType
        : rawObj.LogonType !== undefined
        ? rawObj.LogonType
        : null;

    let category: LogCategory = "system";
    let severity = defaultSeverity;
    const sourceApp = "windows";

    const parsed: ParsedFields = {
      actor: actor && actor !== "-" ? actor : null,
      src_ip: srcIp && srcIp !== "-" && srcIp !== "127.0.0.1" && srcIp !== "::1" ? srcIp : (srcIp || null),
      dst_ip: null,
      action: null,
      outcome: "unknown",
      app: "windows",
      eventId: eventId ?? null,
      logonType: logonType ? String(logonType) : null,
    };

    // Bersihkan IP jika bernilai "-"
    if (parsed.src_ip === "-") parsed.src_ip = null;

    // 2. Pemetaan Berdasarkan EventID
    switch (eventId) {
      case 4624: // Successful Logon
        category = "auth";
        parsed.action = "login";
        parsed.outcome = "success";
        severity = 6; // Informational
        break;

      case 4625: // Failed Logon
        category = "auth";
        parsed.action = "login";
        parsed.outcome = "failure";
        severity = 4; // Warning
        parsed.reason = (eventData.Status as string) || (eventData.SubStatus as string) || "Bad password or username";
        break;

      case 4634: // Logoff
      case 4647: // User-Initiated Logoff
        category = "auth";
        parsed.action = "logout";
        parsed.outcome = "success";
        severity = 6;
        break;

      case 4648: // Explicit Credentials Logon (RunAs)
        category = "auth";
        parsed.action = "explicit_credentials";
        parsed.outcome = "success";
        severity = 5;
        break;

      case 4672: // Special Privileges Assigned (Administrator)
        category = "auth";
        parsed.action = "privilege_assign";
        parsed.outcome = "success";
        severity = 5;
        break;

      case 4720: // User Account Created
        category = "config";
        parsed.action = "user_create";
        parsed.outcome = "success";
        severity = 4; // Warning (Audit perubahan akun)
        parsed.target_user = (eventData.TargetUserName as string) || null;
        break;

      case 4722: // User Account Enabled
        category = "config";
        parsed.action = "user_enable";
        parsed.outcome = "success";
        severity = 5;
        parsed.target_user = (eventData.TargetUserName as string) || null;
        break;

      case 4724: // Password Reset Attempt
        category = "config";
        parsed.action = "password_reset";
        parsed.outcome = "success";
        severity = 4;
        parsed.target_user = (eventData.TargetUserName as string) || null;
        break;

      case 4726: // User Account Deleted
        category = "config";
        parsed.action = "user_delete";
        parsed.outcome = "success";
        severity = 4;
        parsed.target_user = (eventData.TargetUserName as string) || null;
        break;

      case 4732: // Member Added to Security Local Group (cth: Administrators)
        category = "config";
        parsed.action = "group_member_add";
        parsed.outcome = "success";
        severity = 3; // Error / High alert
        parsed.group_name = (eventData.TargetGroupName as string) || "Administrators";
        parsed.member_name = (eventData.MemberName as string) || (eventData.MemberSid as string) || null;
        break;

      case 4740: // User Account Locked Out
        category = "auth";
        parsed.action = "account_lockout";
        parsed.outcome = "failure";
        severity = 3;
        break;

      case 1102: // Audit Log Cleared
        category = "system";
        parsed.action = "log_cleared";
        parsed.outcome = "success";
        severity = 2; // Critical!
        break;

      case 7045: // New Service Installed
        category = "config";
        parsed.action = "service_install";
        parsed.outcome = "success";
        severity = 4;
        parsed.service_name = (eventData.ServiceName as string) || null;
        parsed.image_path = (eventData.ImagePath as string) || null;
        break;

      default:
        // Coba parsing kata kunci jika EventID tidak diketahui
        if (/failed|error|denied|failure/i.test(textRepresentation)) {
          parsed.outcome = "failure";
          severity = 4;
        } else if (/success|accepted|granted/i.test(textRepresentation)) {
          parsed.outcome = "success";
        }
        parsed.action = parsed.action || "windows_event";
        break;
    }

    // Jika belum ada src_ip dan ada IP di teks
    if (!parsed.src_ip) {
      const fallbackIp = textRepresentation.match(/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b/);
      if (fallbackIp && fallbackIp[1] !== "127.0.0.1") {
        parsed.src_ip = fallbackIp[1];
      }
    }

    return { severity, category, sourceApp, parsed };
  } catch {
    return {
      severity: defaultSeverity,
      category: "other",
      sourceApp: "windows",
      parsed: { action: "parse_error", outcome: "unknown", app: "windows" },
    };
  }
}
