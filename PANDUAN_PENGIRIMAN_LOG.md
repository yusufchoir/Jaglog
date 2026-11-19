# Panduan Integrasi & Pengiriman Log ke Server JagaLog

Dokumen ini berisi panduan teknis lengkap untuk mengalirkan log dari perangkat jaringan (MikroTik, Linux, Windows Server) ke JagaLog yang telah di-deploy di Coolify (`https://jagalog.maudynetwork.id`).

---

## 1. Prasyarat di Server (Coolify & VPS)

Sebelum menghubungkan perangkat, pastikan server Coolify siap menerima trafik Syslog UDP:

1. **Port Mapping di Coolify**:
   - Buka dashboard **Coolify** → Aplikasi **JagaLog** → Tab **Settings / General**.
   - Pada bagian **Port Mappings** (Expose Ports), pastikan terpasang:
     ```text
     5514:5514
     ```
   - *Catatan:* Port 3000 ditangani oleh Traefik/domain HTTPS, sedangkan port 5514 dialirkan langsung untuk penerimaan UDP/TCP Syslog.

2. **Firewall VPS (UFW / Security Group Cloud)**:
   - Jika VPS menggunakan Ubuntu/Debian dengan UFW, izinkan port 5514 UDP:
     ```bash
     sudo ufw allow 5514/udp
     sudo ufw reload
     ```
   - Jika menggunakan AWS/DigitalOcean/Hetzner/IDCloudHost, pastikan Inbound Security Group mengizinkan **UDP port 5514** dari `0.0.0.0/0` (atau IP publik kantor/router).

3. **Status Deployment**:
   - Lakukan **Redeploy** di Coolify jika ada pembaruan kode agar daemon Collector & Ingest Worker aktif di background.

---

## 2. Pengiriman Log dari MikroTik RouterOS

Tersedia 2 metode pengiriman dari MikroTik:

### Metode 1: Syslog Bawaan (Realtime UDP Socket) — *Sangat Direkomendasikan*

Metode ini adalah cara standar MikroTik mengirim log secara instan (setiap kali ada event langsung dikirim via UDP).

#### Aturan & Langkah Konfigurasi:
> ⚠️ **PENTING:** Parameter `remote` harus diisi **IP Publik VPS** (bukan domain `https://...`), karena MikroTik Syslog menggunakan koneksi raw UDP.

Jalankan perintah berikut di Terminal MikroTik (Winbox / SSH):

```routeros
# 1. Buat Action Remote Syslog ke Server JagaLog
/system logging action
add name=jagalog target=remote remote=103.56.206.75 remote-port=5514 bsd-syslog=yes src-address=0.0.0.0

# 2. Arahkan Topik Log yang Ingin Diawasi
/system logging
add action=jagalog topics=info
add action=jagalog topics=warning
add action=jagalog topics=error
add action=jagalog topics=critical
add action=jagalog topics=account
add action=jagalog topics=firewall

# 3. Uji Coba Pengiriman Log
:log info "Tes pengiriman log MikroTik ke JagaLog Coolify"
```

---

### Metode 2: REST API Ingest (HTTPS / Webhook) — *Alternatif Jika UDP Diblokir*

Jika jaringan MikroTik berada di balik ISP yang memblokir port UDP keluar, atau tidak memiliki akses membuka port di VPS, gunakan endpoint REST API HTTPS bawaan JagaLog.

#### Aturan & Langkah Konfigurasi:
1. Buka dashboard JagaLog di browser: `https://jagalog.maudynetwork.id/perangkat`.
2. Klik perangkat MikroTik Anda, lalu salin **Ingest Token** perangkat.
3. Buat script pengirim otomatis di MikroTik Terminal:

```routeros
/system script
add name=kirim_log_jagalog policy=read,write,test source="
:local token \"<MASUKKAN_INGEST_TOKEN_PERANGKAT>\"
:local url \"https://jagalog.maudynetwork.id/api/ingest\"
:local identity [/system identity get name]

# Ambil log dan kirim ke server via HTTP POST
:foreach i in=[/log find] do={
  :local msg [/log get \$i message]
  :local time [/log get \$i time]
  :local payload (\"[{\\\"message\\\":\\\"\" . \$msg . \"\\\",\\\"hostname\\\":\\\"\" . \$identity . \"\\\",\\\"timestamp\\\":\\\"\" . \$time . \"\\\"}]\")
  /tool fetch http-method=post url=\$url http-header-field=\"Content-Type: application/json,Authorization: Bearer \$token\" http-data=\$payload keep-result=no
}
"

# Pasang penjadwal (Scheduler) agar berjalan otomatis setiap 1 menit:
/system scheduler
add name=scheduler_jagalog interval=1m on-event=kirim_log_jagalog start-time=startup
```

---

## 3. Pengiriman Log dari Linux Server (Ubuntu / Debian / CentOS)

### Opsi A: Menggunakan Rsyslog (Syslog UDP)
Tambahkan baris berikut di file `/etc/rsyslog.d/50-jagalog.conf`:

```text
*.* @<IP_PUBLIK_VPS>:5514
```

Lalu restart service rsyslog:
```bash
sudo systemctl restart rsyslog
```

### Opsi B: Menggunakan REST API (Curl / Script)
```bash
curl -X POST https://jagalog.maudynetwork.id/api/ingest \
  -H "Authorization: Bearer <INGEST_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "message": "Auth failure for user root from 198.51.100.2 port 22 ssh2",
      "severity": "warning",
      "sourceApp": "sshd"
    }
  ]'
```

---

## 4. Pengiriman Log dari Windows Server

### Opsi A: Menggunakan PowerShell Script (REST API HTTPS)
```powershell
$token = "<INGEST_TOKEN>"
$url = "https://jagalog.maudynetwork.id/api/ingest"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$body = @(
    @{
        message   = "Event ID 4625: An account failed to log on (Audit Failure)"
        severity  = "warning"
        sourceApp = "Security"
    }
) | ConvertTo-Json

Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
```

---

## 5. Checklist Verifikasi & Troubleshooting

| Gejala Masalah | Penyebab Umum | Solusi Tindakan |
|---|---|---|
| REST API berhasil, tapi Syslog UDP MikroTik belum masuk | Port 5514 UDP belum di-forward atau diblokir firewall | 1. Cek Port Mappings Coolify: `5514:5514`<br>2. Cek firewall VPS: `ufw allow 5514/udp`<br>3. Pastikan `remote` di MikroTik adalah **IP Publik VPS**, bukan link domain. |
| Log ditolak / Error 401 di REST API | Token Ingest salah atau perangkat nonaktif | Salin ulang Ingest Token dari halaman `/perangkat` dan pastikan toggle status perangkat dalam kondisi **Aktif**. |
| Log masuk tapi tidak terhubung ke perangkat tertentu | IP asal NAT ISP berbeda dengan IP terdaftar | JagaLog memiliki fitur pencocokan hostname otomatis. Pastikan nama Identity MikroTik sama dengan nama perangkat yang terdaftar di JagaLog. |
| Status perangkat tetap 'Offline' | Belum ada log masuk dalam 10 menit terakhir | Begitu log pertama diterima oleh server, status otomatis berubah menjadi **Online** (hijau). |
