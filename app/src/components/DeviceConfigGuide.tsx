"use client";

import { useState } from "react";

interface DeviceConfigGuideProps {
  deviceType: string;
  deviceName: string;
  deviceIp?: string | null;
  serverHost?: string;
  syslogPort?: number | string;
}

export function DeviceConfigGuide({
  deviceType,
  deviceName,
  deviceIp,
  serverHost = "IP_SERVER_JAGALOG",
  syslogPort = "5514",
}: DeviceConfigGuideProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const registeredIpHint = deviceIp || "IP_TERDAFTAR_DI_JAGALOG";

  const mikrotikConfig = `# 1. Konfigurasi Action Remote Syslog (RouterOS v7 & v6)
# Rekomendasi: aktifkan remote-log-format=syslog (Add Topics) dan pastikan src-address sesuai IP terdaftar (${registeredIpHint}):
/system logging action
add name=jagalog target=remote remote=${serverHost} remote-port=${syslogPort} \\
    src-address=${deviceIp || "0.0.0.0"} bsd-syslog=yes remote-log-format=syslog syslog-facility=local0

# 2. Buat satu rule per topik di /system logging agar setiap kategori log terpetakan akurat:
/system logging
add action=jagalog topics=system,info
add action=jagalog topics=error
add action=jagalog topics=critical
add action=jagalog topics=account
add action=jagalog topics=firewall
add action=jagalog topics=wireless
add action=jagalog topics=dhcp

# 3. Konfigurasi Heartbeat (agar perangkat tetap terdeteksi Online):
/system scheduler
add name=jagalog-heartbeat interval=1m on-event=":log info \\"heartbeat jagalog\\""

# 4. Perintah Uji Pengiriman Log Langsung dari Terminal MikroTik:
/log info "tes pengiriman syslog dari ${deviceName} ke JagaLog"`;

  const mikrotikVerifyCmd = `# Jalankan di terminal server JagaLog untuk memverifikasi paket UDP masuk:
sudo tcpdump -ni any udp port ${syslogPort} -vv -A ${deviceIp ? `and host ${deviceIp}` : ""}`;

  const linuxConfig = `# Buat file konfigurasi: /etc/rsyslog.d/90-jagalog.conf
# Kirim seluruh log sistem ke JagaLog via UDP atau TCP (@@ = TCP, @ = UDP)
*.* @@${serverHost}:${syslogPort}

# Jalankan perintah berikut di terminal:
# sudo systemctl restart rsyslog
# logger "Tes pengiriman log awal dari $(hostname)"

# Konfigurasi Heartbeat via Cron (agar status perangkat terpantau Online):
# Tambahkan baris berikut ke crontab (crontab -e):
* * * * * logger -t jagalog "heartbeat"`;

  const windowsConfig = `<Extension json>
    Module xm_json
</Extension>

<Input security>
    Module im_msvistalog
    Query <QueryList><Query Id="0"><Select Path="Security">*[System[(EventID=4624 or EventID=4625 or EventID=4648 or EventID=4672 or EventID=4720 or EventID=4732 or EventID=4740)]]</Select><Select Path="System">*[System[(EventID=7045)]]</Select></Query></QueryList>
</Input>

<Output jagalog>
    Module om_http
    URL http://${serverHost}:3000/api/ingest
    HTTPSAllowUntrusted FALSE
    AddHeader Authorization: Bearer <TOKEN_INGEST_PERANGKAT>
    AddHeader Content-Type: application/json
    Exec to_json();
</Output>

<Route r1>
    Path security => jagalog
</Route>`;

  const genericConfig = `1. Buka antarmuka manajemen web perangkat ${deviceName}.
2. Masuk ke menu: Pengaturan Sistem / Maintenance -> Log Server / Remote Syslog.
3. Masukkan Host/IP Server: ${serverHost}
4. Masukkan Port Syslog: ${syslogPort} (Protokol UDP atau TCP).
5. Pilih Facility: local0 atau auth/syslog, Severity level: Informational ke atas.
6. Pastikan IP perangkat (${deviceIp || "IP lokal perangkat"}) terdaftar dan aktif di JagaLog.`;

  return (
    <div
      style={{
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--text-main)",
              letterSpacing: "-0.2px",
            }}
          >
            Cara Mengirim Log ({deviceType.toUpperCase()})
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Terapkan konfigurasi berikut pada perangkat agar log otomatis terkirim dan diproses oleh JagaLog.
          </p>
        </div>
      </div>

      {deviceType === "mikrotik" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
              Perintah RouterOS (CLI / Winbox Terminal):
            </span>
            <button
              onClick={() => copyToClipboard(mikrotikConfig, "mikrotik")}
              className="touch-target"
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                cursor: "pointer",
                color: copiedKey === "mikrotik" ? "var(--accent-blue)" : "var(--text-main)",
                fontWeight: 600,
              }}
            >
              {copiedKey === "mikrotik" ? "Tersalin" : "Salin Perintah"}
            </button>
          </div>
          <pre
            className="font-mono"
            style={{
              backgroundColor: "#F9F9F8",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              fontSize: "12px",
              lineHeight: 1.5,
              overflowX: "auto",
              color: "var(--text-main)",
            }}
          >
            {mikrotikConfig}
          </pre>
          <div
            style={{
              marginTop: "12px",
              padding: "12px 14px",
              backgroundColor: "#F8FAFC",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
              color: "var(--text-main)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--text-main)" }}>
              Panduan Penting RouterOS v7 & Cara Verifikasi Paket (`tcpdump`):
            </div>
            <ul style={{ margin: 0, paddingLeft: "18px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <li>
                <strong>Format Log & Topik:</strong> Pada RouterOS v7 (Winbox: <em>System &rarr; Logging &rarr; Actions</em>), pilih <code>Remote Log Format: syslog</code> dan centang <strong>Add Topics</strong> (CLI: <code>remote-log-format=syslog</code>), serta buat <strong>satu rule per topik</strong> di <code>/system logging</code>. Parser JagaLog mendukung format <code>default</code> maupun <code>syslog</code>.
              </li>
              <li>
                <strong>Kesesuaian IP Pengirim (`src-address`):</strong> Syslog UDP dikenali dari alamat IP pengirim paket. Pastikan <code>src-address</code> pada <code>/system logging action</code> sama dengan IP yang terdaftar di JagaLog ({deviceIp ? <code>{deviceIp}</code> : "isi IP di Edit Perangkat"}) dan tidak ter-NAT ke IP lain.
              </li>
              <li>
                <strong>Uji & Baca Paket di Server (`tcpdump`):</strong> Ketik <code>/log info &quot;tes jagalog&quot;</code> di terminal MikroTik, lalu pantau di server JagaLog dengan perintah berikut. Perhatikan kolom <code>IP &lt;IP_PENGIRIM&gt;.port &gt; &lt;IP_SERVER&gt;.{syslogPort}</code> — pastikan <code>&lt;IP_PENGIRIM&gt;</code> persis sama dengan IP perangkat yang terdaftar dan perangkat berstatus <strong>Aktif</strong>.
              </li>
            </ul>
            <pre
              className="font-mono"
              style={{
                backgroundColor: "#FFFFFF",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                fontSize: "11px",
                overflowX: "auto",
                margin: 0,
              }}
            >
              {mikrotikVerifyCmd}
            </pre>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
            * Catatan: Jika memantau firewall, tambahkan <code>log=yes log-prefix=&quot;DROP:&quot;</code> pada rule drop yang diinginkan.
          </p>
        </div>
      )}

      {deviceType === "linux" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
              Konfigurasi Rsyslog Linux:
            </span>
            <button
              onClick={() => copyToClipboard(linuxConfig, "linux")}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                cursor: "pointer",
                color: copiedKey === "linux" ? "var(--accent-blue)" : "var(--text-main)",
                fontWeight: 500,
              }}
            >
              {copiedKey === "linux" ? "Tersalin" : "Salin Konfigurasi"}
            </button>
          </div>
          <pre
            className="font-mono"
            style={{
              backgroundColor: "#F9F9F8",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              fontSize: "12px",
              lineHeight: 1.5,
              overflowX: "auto",
              color: "var(--text-main)",
            }}
          >
            {linuxConfig}
          </pre>
        </div>
      )}

      {deviceType === "windows" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
              Konfigurasi NXLog (nxlog.conf):
            </span>
            <button
              onClick={() => copyToClipboard(windowsConfig, "windows")}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                cursor: "pointer",
                color: copiedKey === "windows" ? "var(--accent-blue)" : "var(--text-main)",
                fontWeight: 500,
              }}
            >
              {copiedKey === "windows" ? "Tersalin" : "Salin Konfigurasi"}
            </button>
          </div>
          <pre
            className="font-mono"
            style={{
              backgroundColor: "#F9F9F8",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              fontSize: "12px",
              lineHeight: 1.5,
              overflowX: "auto",
              color: "var(--text-main)",
            }}
          >
            {windowsConfig}
          </pre>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
            * Ganti <code>&lt;TOKEN_INGEST_PERANGKAT&gt;</code> dengan token 32-byte yang digenerate saat perangkat dibuat.
          </p>
        </div>
      )}

      {(deviceType === "switch" || deviceType === "firewall" || deviceType === "other") && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
              Panduan Konfigurasi Remote Syslog:
            </span>
            <button
              onClick={() => copyToClipboard(genericConfig, "generic")}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                cursor: "pointer",
                color: copiedKey === "generic" ? "var(--accent-blue)" : "var(--text-main)",
                fontWeight: 500,
              }}
            >
              {copiedKey === "generic" ? "Tersalin" : "Salin Petunjuk"}
            </button>
          </div>
          <pre
            style={{
              backgroundColor: "#F9F9F8",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              fontSize: "13px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              color: "var(--text-main)",
            }}
          >
            {genericConfig}
          </pre>
        </div>
      )}
    </div>
  );
}
