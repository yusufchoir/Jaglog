import { test, describe } from "node:test";
import assert from "node:assert";
import {
  parseMikrotikLog,
  parseLinuxLog,
  parseWindowsLog,
  parseGenericLog,
  parseLog,
} from "../src/parsers";

describe("Phase 5: Log Parsers & Normalization Tests", () => {
  // ==========================================
  // 1. MIKROTIK ROUTEROS PARSER
  // ==========================================
  describe("1. MikroTik RouterOS Parser", () => {
    test("Contoh 1: Login failure via SSH", () => {
      const msg = "login failure for user admin from 203.0.113.5 via ssh";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "admin");
      assert.strictEqual(res.parsed.src_ip, "203.0.113.5");
      assert.strictEqual(res.parsed.app, "ssh");
      assert.strictEqual(res.severity, 4);
    });

    test("Contoh 2: Login success via Winbox dengan topik", () => {
      const msg = "system,info,account user admin logged in from 192.168.88.10 via winbox";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.actor, "admin");
      assert.strictEqual(res.parsed.src_ip, "192.168.88.10");
      assert.strictEqual(res.parsed.app, "winbox");
      assert.strictEqual(res.severity, 6);
    });

    test("Contoh 3: Firewall forward packet", () => {
      const msg = "firewall,info forward: in:ether1 out:ether2, proto TCP (SYN), 198.51.100.23:44123->192.168.1.50:80, len 60";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "firewall");
      assert.strictEqual(res.parsed.action, "forward");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.interface, "ether1");
      assert.strictEqual(res.parsed.src_ip, "198.51.100.23");
      assert.strictEqual(res.parsed.dst_ip, "192.168.1.50");
      assert.strictEqual(res.parsed.src_port, 44123);
      assert.strictEqual(res.parsed.dst_port, 80);
    });

    test("Contoh 4: DHCP lease assign", () => {
      const msg = "dhcp,info dhcp1 assigned 192.168.88.150 to 00:0C:42:11:22:33";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "network");
      assert.strictEqual(res.sourceApp, "dhcp");
      assert.strictEqual(res.parsed.action, "assigned");
      assert.strictEqual(res.parsed.src_ip, "192.168.88.150");
      assert.strictEqual(res.parsed.actor, "00:0C:42:11:22:33");
      assert.strictEqual(res.parsed.outcome, "success");
    });

    test("Contoh 5: Wireless client connect", () => {
      const msg = "wireless,info 00:11:22:33:44:55@wlan1: connected, signal strength -65";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "network");
      assert.strictEqual(res.sourceApp, "wireless");
      assert.strictEqual(res.parsed.actor, "00:11:22:33:44:55");
      assert.strictEqual(res.parsed.interface, "wlan1");
      assert.strictEqual(res.parsed.action, "connected");
      assert.strictEqual(res.parsed.outcome, "success");
    });

    test("Contoh 6: Configuration change", () => {
      const msg = "system,info user admin changed configuration at /ip firewall filter";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.parsed.action, "config_change");
      assert.strictEqual(res.parsed.actor, "admin");
      assert.strictEqual(res.parsed.command, "/ip firewall filter");
    });

    test("Contoh 7: System critical crash / watchdog reboot", () => {
      const msg = "system,error,critical router rebooted without proper shutdown by watchdog";
      const res = parseMikrotikLog(msg);

      assert.strictEqual(res.category, "system");
      assert.strictEqual(res.parsed.action, "reboot");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.severity, 2); // Critical
    });

    test("Robustness: Log rusak tidak boleh membuat parser crash", () => {
      assert.doesNotThrow(() => parseMikrotikLog(""));
      assert.doesNotThrow(() => parseMikrotikLog("   "));
      assert.doesNotThrow(() => parseMikrotikLog("system,info"));
      assert.doesNotThrow(() => parseMikrotikLog("@@##$$%%^^&&**()_+|~"));
      assert.doesNotThrow(() => parseMikrotikLog("login failure for user"));
      assert.doesNotThrow(() => parseMikrotikLog("firewall,info in: out: -> proto len"));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseMikrotikLog(null));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseMikrotikLog(undefined));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseMikrotikLog(12345));

      const res = parseMikrotikLog("string acak rusak tanpa pola");
      assert.ok(res.parsed);
      assert.strictEqual(typeof res.category, "string");
    });

    test("RouterOS v7 format default (dengan dan tanpa topik)", () => {
      // 1. Format default dengan timestamp RouterOS & topik
      const rawDefaultWithTopics = "nov/14 12:34:56 system,info,account user admin logged in from 192.168.88.10 via winbox";
      const res1 = parseMikrotikLog(rawDefaultWithTopics);
      assert.strictEqual(res1.category, "auth");
      assert.strictEqual(res1.severity, 6);
      assert.deepStrictEqual(res1.parsed.topics, ["system", "info", "account"]);
      assert.strictEqual(res1.parsed.actor, "admin");
      assert.strictEqual(res1.parsed.src_ip, "192.168.88.10");
      assert.strictEqual(res1.parsed.app, "winbox");

      // 2. Format default tanpa topik
      const rawDefaultNoTopics = "nov/14 12:34:56 login failure for user root from 203.0.113.99 via ssh";
      const res2 = parseMikrotikLog(rawDefaultNoTopics);
      assert.strictEqual(res2.category, "auth");
      assert.strictEqual(res2.severity, 4);
      assert.deepStrictEqual(res2.parsed.topics, []);
      assert.strictEqual(res2.parsed.actor, "root");
      assert.strictEqual(res2.parsed.src_ip, "203.0.113.99");
      assert.strictEqual(res2.parsed.outcome, "failure");
    });

    test("RouterOS v7 format syslog RFC 3164 (dengan dan tanpa topik di awal pesan)", () => {
      // 1. Format syslog dengan Add Topics (titik dua setelah topik)
      const rawSyslogWithTopics = "<134>Nov 14 12:34:56 SERVER181 system,info,account: user admin logged in from 192.168.88.10 via winbox";
      const res1 = parseMikrotikLog(rawSyslogWithTopics);
      assert.strictEqual(res1.category, "auth");
      assert.strictEqual(res1.severity, 6);
      assert.deepStrictEqual(res1.parsed.topics, ["system", "info", "account"]);
      assert.strictEqual(res1.parsed.actor, "admin");
      assert.strictEqual(res1.parsed.src_ip, "192.168.88.10");

      // 2. Format syslog dengan topik critical/error
      const rawSyslogCritical = "<130>Nov 14 12:34:56 SERVER181 system,error,critical: router rebooted without proper shutdown by watchdog";
      const res2 = parseMikrotikLog(rawSyslogCritical);
      assert.strictEqual(res2.category, "system");
      assert.strictEqual(res2.severity, 2);
      assert.deepStrictEqual(res2.parsed.topics, ["system", "error", "critical"]);
      assert.strictEqual(res2.parsed.action, "reboot");
      assert.strictEqual(res2.parsed.outcome, "failure");

      // 3. Format syslog tanpa topik di awal pesan
      const rawSyslogNoTopics = "<134>Nov 14 12:34:56 SERVER181: user admin logged in from 192.168.88.10 via winbox";
      const res3 = parseMikrotikLog(rawSyslogNoTopics);
      assert.strictEqual(res3.category, "auth");
      assert.strictEqual(res3.severity, 6);
      assert.deepStrictEqual(res3.parsed.topics, []);
      assert.strictEqual(res3.parsed.actor, "admin");
      assert.strictEqual(res3.parsed.src_ip, "192.168.88.10");
    });
  });

  // ==========================================
  // 2. LINUX PARSER
  // ==========================================
  describe("2. Linux Parser", () => {
    test("Contoh 1: SSHD Failed password", () => {
      const msg = "Failed password for invalid user ubnt from 192.168.1.100 port 49152 ssh2";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.sourceApp, "sshd");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "ubnt");
      assert.strictEqual(res.parsed.src_ip, "192.168.1.100");
      assert.strictEqual(res.parsed.src_port, 49152);
      assert.strictEqual(res.parsed.method, "password");
      assert.strictEqual(res.severity, 4);
    });

    test("Contoh 2: SSHD Accepted publickey", () => {
      const msg = "Accepted publickey for ubuntu from 10.0.0.5 port 55432 ssh2: RSA SHA256:abc";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.sourceApp, "sshd");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.actor, "ubuntu");
      assert.strictEqual(res.parsed.src_ip, "10.0.0.5");
      assert.strictEqual(res.parsed.src_port, 55432);
      assert.strictEqual(res.parsed.method, "publickey");
      assert.strictEqual(res.severity, 6);
    });

    test("Contoh 3: SUDO authentication failure", () => {
      const msg = "pam_unix(sudo:auth): authentication failure; logname=john uid=1000 euid=0 tty=/dev/pts/0 ruser=john rhost= user=john";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.sourceApp, "sudo");
      assert.strictEqual(res.parsed.action, "sudo");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "john");
      assert.strictEqual(res.severity, 4);
    });

    test("Contoh 4: SUDO command execution", () => {
      const msg = "john : TTY=pts/1 ; PWD=/home/john ; USER=root ; COMMAND=/bin/cat /etc/shadow";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.sourceApp, "sudo");
      assert.strictEqual(res.parsed.action, "sudo_command");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.actor, "john");
      assert.strictEqual(res.parsed.target_user, "root");
      assert.strictEqual(res.parsed.command, "/bin/cat /etc/shadow");
    });

    test("Contoh 5: UFW packet block", () => {
      const msg = "[UFW BLOCK] IN=eth0 OUT= MAC=00:11:22:33:44:55 SRC=198.51.100.77 DST=10.0.0.2 LEN=40 TOS=0x00 PROTO=TCP SPT=54321 DPT=22 WINDOW=1024 SYN";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "firewall");
      assert.strictEqual(res.sourceApp, "ufw");
      assert.strictEqual(res.parsed.action, "drop");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.src_ip, "198.51.100.77");
      assert.strictEqual(res.parsed.dst_ip, "10.0.0.2");
      assert.strictEqual(res.parsed.src_port, 54321);
      assert.strictEqual(res.parsed.dst_port, 22);
      assert.strictEqual(res.parsed.interface, "eth0");
      assert.strictEqual(res.parsed.protocol, "TCP");
    });

    test("Contoh 6: Kernel Out of Memory Kill", () => {
      const msg = "kernel: Out of memory: Kill process 1234 (mysqld) score 850 or sacrifice child";
      const res = parseLinuxLog(msg);

      assert.strictEqual(res.category, "system");
      assert.strictEqual(res.sourceApp, "kernel");
      assert.strictEqual(res.parsed.action, "oom_kill");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "mysqld");
      assert.strictEqual(res.severity, 2); // Critical
    });

    test("Robustness: Log linux rusak tidak boleh membuat parser crash", () => {
      assert.doesNotThrow(() => parseLinuxLog(""));
      assert.doesNotThrow(() => parseLinuxLog("sshd: "));
      assert.doesNotThrow(() => parseLinuxLog("sudo: ;;;;;;"));
      assert.doesNotThrow(() => parseLinuxLog("[UFW BLOCK]"));
      assert.doesNotThrow(() => parseLinuxLog("kernel: "));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseLinuxLog(null));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseLinuxLog(undefined));

      const res = parseLinuxLog("random broken text without match");
      assert.ok(res.parsed);
      assert.strictEqual(typeof res.category, "string");
    });
  });

  // ==========================================
  // 3. WINDOWS EVENT LOG PARSER
  // ==========================================
  describe("3. Windows Event Log Parser", () => {
    test("Contoh 1: EventID 4624 (Logon Berhasil)", () => {
      const payload = {
        EventID: 4624,
        Channel: "Security",
        TargetUserName: "Alice",
        IpAddress: "192.168.1.50",
        LogonType: 10, // Remote Interactive (RDP)
      };
      const res = parseWindowsLog(payload);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.actor, "Alice");
      assert.strictEqual(res.parsed.src_ip, "192.168.1.50");
      assert.strictEqual(res.parsed.logonType, "10");
      assert.strictEqual(res.parsed.eventId, 4624);
      assert.strictEqual(res.severity, 6);
    });

    test("Contoh 2: EventID 4625 (Logon Gagal)", () => {
      const jsonStr = JSON.stringify({
        EventID: 4625,
        Channel: "Security",
        TargetUserName: "Administrator",
        IpAddress: "203.0.113.88",
        LogonType: 3,
        Status: "0xC000006D",
      });
      const res = parseWindowsLog(jsonStr);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "Administrator");
      assert.strictEqual(res.parsed.src_ip, "203.0.113.88");
      assert.strictEqual(res.parsed.eventId, 4625);
      assert.strictEqual(res.severity, 4);
    });

    test("Contoh 3: EventID 4720 (User Account Created)", () => {
      const payload = {
        EventID: 4720,
        TargetUserName: "backdoor_user",
        SubjectUserName: "Administrator",
      };
      const res = parseWindowsLog(payload);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.parsed.action, "user_create");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.target_user, "backdoor_user");
      assert.strictEqual(res.severity, 4);
    });

    test("Contoh 4: EventID 4732 (Member Added to Security Group)", () => {
      const payload = {
        EventID: 4732,
        TargetGroupName: "Administrators",
        MemberName: "CN=backdoor_user,CN=Users,DC=corp,DC=local",
      };
      const res = parseWindowsLog(payload);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.parsed.action, "group_member_add");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.group_name, "Administrators");
      assert.strictEqual(res.parsed.member_name, "CN=backdoor_user,CN=Users,DC=corp,DC=local");
      assert.strictEqual(res.severity, 3); // High alert
    });

    test("Contoh 5: EventID 1102 (Security Audit Log Cleared)", () => {
      const payload = {
        EventID: 1102,
        Channel: "Security",
        SubjectUserName: "Administrator",
      };
      const res = parseWindowsLog(payload);

      assert.strictEqual(res.category, "system");
      assert.strictEqual(res.parsed.action, "log_cleared");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.severity, 2); // Critical
    });

    test("Contoh 6: EventID 7045 (New Service Installed)", () => {
      const payload = {
        EventID: 7045,
        ServiceName: "MaliciousService",
        ImagePath: "C:\\Windows\\Temp\\payload.exe",
      };
      const res = parseWindowsLog(payload);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.parsed.action, "service_install");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.service_name, "MaliciousService");
      assert.strictEqual(res.parsed.image_path, "C:\\Windows\\Temp\\payload.exe");
    });

    test("Contoh 7: Format Winlogbeat bertingkat (winlog.event_data)", () => {
      const winlogbeatMsg = {
        winlog: {
          event_id: 4624,
          channel: "Security",
          event_data: {
            TargetUserName: "Bob",
            IpAddress: "10.10.10.20",
            LogonType: 2,
          },
        },
      };
      const res = parseWindowsLog(winlogbeatMsg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "success");
      assert.strictEqual(res.parsed.actor, "Bob");
      assert.strictEqual(res.parsed.src_ip, "10.10.10.20");
      assert.strictEqual(res.parsed.logonType, "2");
    });

    test("Contoh 8: Format string teks klasik (Syslog EventID)", () => {
      const textMsg = "Microsoft-Windows-Security-Auditing: [4625] An account failed to log on. Account: testuser, IP: 172.16.1.99";
      const res = parseWindowsLog(textMsg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.eventId, 4625);
      assert.strictEqual(res.parsed.src_ip, "172.16.1.99");
    });

    test("Robustness: Log windows rusak / corrupt JSON tidak boleh crash", () => {
      assert.doesNotThrow(() => parseWindowsLog(""));
      assert.doesNotThrow(() => parseWindowsLog("{ EventID: corrupt json"));
      assert.doesNotThrow(() => parseWindowsLog("{\"EventID\": \"invalid_num\"}"));
      assert.doesNotThrow(() => parseWindowsLog({}));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseWindowsLog(null));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseWindowsLog(undefined));

      const res = parseWindowsLog("{ invalid json }");
      assert.ok(res.parsed);
      assert.strictEqual(typeof res.category, "string");
    });
  });

  // ==========================================
  // 4. GENERIC FALLBACK PARSER
  // ==========================================
  describe("4. Generic Fallback Parser", () => {
    test("Contoh 1: Switch Link Up / Down", () => {
      const msg = "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";
      const res = parseGenericLog(msg);

      assert.strictEqual(res.category, "network");
      assert.strictEqual(res.parsed.action, "link_down");
      assert.strictEqual(res.parsed.outcome, "failure");
    });

    test("Contoh 2: Cisco ACL Deny Packet", () => {
      const msg = "%SEC-6-IPACCESSLOGP: list 101 denied tcp 192.0.2.1(12345) -> 198.51.100.1(80), 1 packet";
      const res = parseGenericLog(msg);

      assert.strictEqual(res.category, "firewall");
      assert.strictEqual(res.parsed.action, "block");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.src_ip, "192.0.2.1");
      assert.strictEqual(res.parsed.dst_ip, "198.51.100.1");
    });

    test("Contoh 3: Generic Authentication Failure", () => {
      const msg = "User login failed for user operator from 172.20.1.5 via web";
      const res = parseGenericLog(msg);

      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.action, "login");
      assert.strictEqual(res.parsed.outcome, "failure");
      assert.strictEqual(res.parsed.actor, "operator");
      assert.strictEqual(res.parsed.src_ip, "172.20.1.5");
    });

    test("Contoh 4: Config commit / change", () => {
      const msg = "Configuration changed by admin from 10.0.0.1";
      const res = parseGenericLog(msg);

      assert.strictEqual(res.category, "config");
      assert.strictEqual(res.parsed.action, "config_change");
      assert.strictEqual(res.parsed.actor, "admin");
      assert.strictEqual(res.parsed.src_ip, "10.0.0.1");
    });

    test("Contoh 5: System reboot / restart notice", () => {
      const msg = "System reboot initiated by user superadmin from 192.168.1.1";
      const res = parseGenericLog(msg);

      assert.strictEqual(res.category, "system");
      assert.strictEqual(res.parsed.actor, "superadmin");
      assert.strictEqual(res.parsed.src_ip, "192.168.1.1");
    });

    test("Robustness: Log generic rusak tidak boleh crash", () => {
      assert.doesNotThrow(() => parseGenericLog(""));
      assert.doesNotThrow(() => parseGenericLog("   "));
      assert.doesNotThrow(() => parseGenericLog("!@#$%^&*()_+"));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseGenericLog(null));
      // @ts-expect-error test invalid type
      assert.doesNotThrow(() => parseGenericLog(undefined));

      const res = parseGenericLog("Pesan acak tanpa informasi apapun");
      assert.ok(res.parsed);
      assert.strictEqual(typeof res.category, "string");
    });
  });

  // ==========================================
  // 5. UNIFIED DISPATCHER (parseLog)
  // ==========================================
  describe("5. Unified Dispatcher (parseLog)", () => {
    test("Otomatis mendeteksi MikroTik dari topik", () => {
      const msg = "system,info,account user admin logged in from 192.168.1.10 via winbox";
      const res = parseLog(msg);
      assert.strictEqual(res.category, "auth");
      assert.strictEqual(res.parsed.app, "winbox");
    });

    test("Otomatis mendeteksi Linux dari pola sshd", () => {
      const msg = "Failed password for root from 1.2.3.4 port 22 ssh2";
      const res = parseLog(msg);
      assert.strictEqual(res.sourceApp, "sshd");
      assert.strictEqual(res.parsed.action, "login");
    });

    test("Otomatis mendeteksi Windows dari EventID", () => {
      const msg = JSON.stringify({ EventID: 4625, TargetUserName: "admin", IpAddress: "1.1.1.1" });
      const res = parseLog(msg);
      assert.strictEqual(res.parsed.app, "windows");
      assert.strictEqual(res.parsed.eventId, 4625);
    });

    test("Mematuhi deviceType yang diberikan", () => {
      const res = parseLog(
        "login failure for user test from 1.1.1.1 via ssh",
        undefined,
        "mikrotik"
      );
      assert.strictEqual(res.sourceApp, "ssh");
      assert.strictEqual(res.parsed.actor, "test");
    });
  });
});
