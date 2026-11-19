import { ParseResult, ParsedFields, LogCategory } from "./types";

/**
 * Parser khusus log sistem Linux:
 *  - sshd: Failed password, Accepted publickey/password, Invalid user
 *  - sudo: authentication failure, COMMAND execution, not in sudoers
 *  - su / PAM: session opened, authentication failure
 *  - ufw / iptables: [UFW BLOCK], [UFW ALLOW], iptables drop/forward
 *  - kernel: Out of memory (OOM), segfault, disk errors
 */
export function parseLinuxLog(
  message: string,
  defaultSeverity: number = 6
): ParseResult {
  try {
    if (!message || typeof message !== "string") {
      return {
        severity: defaultSeverity,
        category: "other",
        sourceApp: "linux",
        parsed: { action: "unknown", outcome: "unknown", app: "linux" },
      };
    }

    const trimmed = message.trim();
    let severity = defaultSeverity;
    let category: LogCategory = "system";
    let sourceApp = "linux";

    const parsed: ParsedFields = {
      actor: null,
      src_ip: null,
      dst_ip: null,
      action: null,
      outcome: "unknown",
      app: "linux",
      method: null,
      command: null,
    };

    // 1. Parser SSHD
    if (/sshd|ssh2|Failed\s+(?:password|publickey)|Accepted\s+(?:password|publickey)|Invalid user/i.test(trimmed)) {
      sourceApp = "sshd";
      parsed.app = "sshd";
      category = "auth";

      // Failed password for [invalid user] <user> from <ip> port <port> ssh2
      const failedMatch = trimmed.match(
        /Failed\s+(password|publickey)\s+for\s+(?:invalid user\s+)?([^\s]+)\s+from\s+([^\s]+)(?:\s+port\s+(\d+))?/i
      );
      if (failedMatch) {
        parsed.action = "login";
        parsed.outcome = "failure";
        parsed.method = failedMatch[1].toLowerCase();
        parsed.actor = failedMatch[2];
        parsed.src_ip = failedMatch[3];
        if (failedMatch[4]) parsed.src_port = parseInt(failedMatch[4], 10);
        severity = 4; // Warning
        return { severity, category, sourceApp, parsed };
      }

      // Accepted password/publickey for <user> from <ip> port <port>
      const acceptedMatch = trimmed.match(
        /Accepted\s+(password|publickey)\s+for\s+([^\s]+)\s+from\s+([^\s]+)(?:\s+port\s+(\d+))?/i
      );
      if (acceptedMatch) {
        parsed.action = "login";
        parsed.outcome = "success";
        parsed.method = acceptedMatch[1].toLowerCase();
        parsed.actor = acceptedMatch[2];
        parsed.src_ip = acceptedMatch[3];
        if (acceptedMatch[4]) parsed.src_port = parseInt(acceptedMatch[4], 10);
        severity = 6;
        return { severity, category, sourceApp, parsed };
      }

      // Invalid user <user> from <ip>
      const invalidUserMatch = trimmed.match(/Invalid user\s+([^\s]+)\s+from\s+([^\s]+)/i);
      if (invalidUserMatch) {
        parsed.action = "login";
        parsed.outcome = "failure";
        parsed.actor = invalidUserMatch[1];
        parsed.src_ip = invalidUserMatch[2];
        severity = 4;
        return { severity, category, sourceApp, parsed };
      }

      // Disconnected from authenticating user / preauth
      const disconnMatch = trimmed.match(/Disconnected from (?:authenticating )?user\s+([^\s]+)\s+([^\s]+)/i);
      if (disconnMatch) {
        parsed.action = "disconnect";
        parsed.outcome = "failure";
        parsed.actor = disconnMatch[1];
        parsed.src_ip = disconnMatch[2];
        severity = 5;
        return { severity, category, sourceApp, parsed };
      }
    }

    // 2. Parser SUDO
    if (/sudo|COMMAND=/i.test(trimmed)) {
      sourceApp = "sudo";
      parsed.app = "sudo";

      // sudo authentication failure
      if (/authentication failure/i.test(trimmed)) {
        category = "auth";
        parsed.action = "sudo";
        parsed.outcome = "failure";
        severity = 4;

        const userMatch = trimmed.match(/user=([^\s]+)/i) || trimmed.match(/ruser=([^\s]+)/i);
        if (userMatch) parsed.actor = userMatch[1];
        const rhostMatch = trimmed.match(/rhost=([^\s]+)/i);
        if (rhostMatch && rhostMatch[1] && rhostMatch[1] !== "") parsed.src_ip = rhostMatch[1];
        return { severity, category, sourceApp, parsed };
      }

      // user NOT in sudoers
      const notInSudoers = trimmed.match(/([^\s]+)\s*:\s*user NOT in sudoers/i);
      if (notInSudoers) {
        category = "auth";
        parsed.action = "sudo_unauthorized";
        parsed.outcome = "failure";
        parsed.actor = notInSudoers[1];
        severity = 3; // Error / Security alert
        return { severity, category, sourceApp, parsed };
      }

      // sudo command: <user> : TTY=... ; PWD=... ; USER=<target_user> ; COMMAND=<cmd>
      const sudoCmdMatch = trimmed.match(/([^\s]+)\s*:\s*TTY=[^;]*;\s*PWD=[^;]*;\s*USER=([^;]*);\s*COMMAND=(.*)$/i);
      if (sudoCmdMatch) {
        category = "config";
        parsed.action = "sudo_command";
        parsed.outcome = "success";
        parsed.actor = sudoCmdMatch[1].trim();
        parsed.target_user = sudoCmdMatch[2].trim();
        parsed.command = sudoCmdMatch[3].trim();
        severity = 5;
        return { severity, category, sourceApp, parsed };
      }
    }

    // 3. Parser SU / PAM
    if (/\bsu\b|pam_unix/i.test(trimmed)) {
      sourceApp = /sudo/.test(trimmed) ? "sudo" : "su";
      parsed.app = sourceApp;
      category = "auth";

      // pam session opened: session opened for user <target> by (uid=...)
      const sessionOpened = trimmed.match(/session opened for user\s+([^\s]+)(?:\s+by\s+([^\s]+|\(uid=\d+\)))?/i);
      if (sessionOpened) {
        parsed.action = "su_session";
        parsed.outcome = "success";
        parsed.actor = sessionOpened[1];
        if (sessionOpened[2]) parsed.caller = sessionOpened[2];
        severity = 6;
        return { severity, category, sourceApp, parsed };
      }

      // pam auth failure
      if (/authentication failure/i.test(trimmed)) {
        parsed.action = "su";
        parsed.outcome = "failure";
        const userMatch = trimmed.match(/user=([^\s]+)/i);
        if (userMatch) parsed.actor = userMatch[1];
        severity = 4;
        return { severity, category, sourceApp, parsed };
      }
    }

    // 4. Parser UFW / IPTables
    if (/\[UFW\s+(BLOCK|AUDIT|ALLOW)\]/i.test(trimmed) || /iptables/i.test(trimmed)) {
      sourceApp = "ufw";
      parsed.app = "ufw";
      category = "firewall";

      const actionMatch = trimmed.match(/\[UFW\s+(BLOCK|AUDIT|ALLOW)\]/i);
      if (actionMatch) {
        const act = actionMatch[1].toUpperCase();
        parsed.action = act === "BLOCK" ? "drop" : act.toLowerCase();
        parsed.outcome = act === "BLOCK" ? "failure" : "success";
        severity = act === "BLOCK" ? 4 : 6;
      } else {
        parsed.action = /drop|reject/i.test(trimmed) ? "drop" : "forward";
        parsed.outcome = parsed.action === "drop" ? "failure" : "success";
      }

      const srcMatch = trimmed.match(/SRC=([0-9.]+)/i);
      if (srcMatch) parsed.src_ip = srcMatch[1];

      const dstMatch = trimmed.match(/DST=([0-9.]+)/i);
      if (dstMatch) parsed.dst_ip = dstMatch[1];

      const inMatch = trimmed.match(/IN=([^\s]+)/i);
      if (inMatch) parsed.interface = inMatch[1];

      const protoMatch = trimmed.match(/PROTO=([A-Z]+)/i);
      if (protoMatch) parsed.protocol = protoMatch[1];

      const sptMatch = trimmed.match(/SPT=(\d+)/i);
      if (sptMatch) parsed.src_port = parseInt(sptMatch[1], 10);

      const dptMatch = trimmed.match(/DPT=(\d+)/i);
      if (dptMatch) parsed.dst_port = parseInt(dptMatch[1], 10);

      return { severity, category, sourceApp, parsed };
    }

    // 5. Parser Kernel (OOM, segfault, hardware)
    if (/kernel:/i.test(trimmed)) {
      sourceApp = "kernel";
      parsed.app = "kernel";
      category = "system";

      if (/Out of memory/i.test(trimmed)) {
        parsed.action = "oom_kill";
        parsed.outcome = "failure";
        severity = 2; // Critical
        const procMatch = trimmed.match(/Kill process \d+ \(([^)]+)\)/i);
        if (procMatch) parsed.actor = procMatch[1];
        return { severity, category, sourceApp, parsed };
      }

      if (/segfault/i.test(trimmed)) {
        parsed.action = "segfault";
        parsed.outcome = "failure";
        severity = 3; // Error
        return { severity, category, sourceApp, parsed };
      }
    }

    // Fallback ekstraksi IP atau user
    const ipMatch = trimmed.match(/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b/);
    if (ipMatch) parsed.src_ip = ipMatch[1];

    const userMatch = trimmed.match(/user\s+([a-zA-Z0-9_.-]+)/i);
    if (userMatch) parsed.actor = userMatch[1];

    parsed.action = parsed.action || "log";
    return { severity, category, sourceApp, parsed };
  } catch {
    return {
      severity: defaultSeverity,
      category: "other",
      sourceApp: "linux",
      parsed: { action: "parse_error", outcome: "unknown", app: "linux" },
    };
  }
}
