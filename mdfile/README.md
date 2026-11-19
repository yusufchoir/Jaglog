# JagaLog – Aplikasi Penerima & Analisa Log Perangkat Jaringan

JagaLog adalah platform terpusat untuk menerima log dari berbagai perangkat jaringan (MikroTik, Windows, Linux, Switch, Firewall), memisahkan data per perangkat, mendeteksi indikasi serangan keamanan, menganalisa dengan AI, dan menyajikan dashboard visual intuitif dengan rekomendasi tindakan.

---

## Struktur Proyek

```
/app            -> Next.js App Router (UI + API routes)
/collector      -> Proses Node.js terpisah (Syslog UDP/TCP listener + BullMQ queue)
/shared         -> Skema Drizzle ORM, migrasi, tipe TypeScript, helper database & Redis
/docker         -> Dockerfile multi-stage untuk app dan collector
docker-compose.dev.yml  -> Postgres 16 + Redis 7 untuk pengembangan lokal
docker-compose.yml      -> Konfigurasi Docker Compose production (Coolify ready)
.env.example            -> Template variabel lingkungan
README.md               -> Dokumentasi dan panduan instalasi
```

---

## Status Pengerjaan

- [x] **FASE 1: Fondasi Proyek, Database & Cache**
  - Struktur monorepo Next.js + Collector + Shared
  - Skema PostgreSQL 16 lengkap dengan Drizzle ORM (users, devices, log_events, incidents, ai_analyses, settings)
  - Index performa: composite `(device_id, event_time desc)`, `(device_id, severity, event_time desc)`, dan GIN `pg_trgm` pada `message`
  - Seed admin otomatis (argon2id hash, `mustChangePassword: true`) dan default settings
  - BullMQ repeatable job untuk pembersihan retensi log harian
  - Healthcheck `/api/health` memverifikasi PostgreSQL & Redis
  - Unit test otomatis lulus 100%
- [x] **FASE 2: Otentikasi, Sesi, Rate Limit & Manajemen Pengguna**
  - Halaman login `/login` dalam Bahasa Indonesia
  - Sesi Redis 12 jam dengan cookie `httpOnly`, `secure`, `sameSite=lax`
  - Rate limiting berbasis Redis: maks 5 kegagalan per 15 menit per kombinasi IP + username (terblokir HTTP 429 pada percobaan ke-6)
  - Middleware proteksi semua route privat dan header keamanan lengkap (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy)
  - Paksa ganti password `/ganti-password` saat login pertama jika `mustChangePassword: true`
  - Role-based Access Control (Admin vs Viewer): halaman `/pengguna` khusus admin untuk tambah user, ubah password, dan nonaktifkan akun
  - Pengujian unit test dan integrasi end-to-end lulus 100%
- [x] **FASE 4: Collector Syslog / HTTP Ingest & Worker Antrian**
  - Collector syslog listener UDP & TCP (port 5514) mendukung RFC 3164 (BSD) & RFC 5424 (IETF)
  - Dukungan TCP framing (newline delimitasi dan octet-counting framing)
  - Endpoint HTTP Ingest `POST /api/ingest` untuk agent Windows/Linux (Bearer token auth, max 500 event / 1 MB)
  - Identifikasi perangkat via IP (syslog) dan hash SHA-256 token (HTTP), counter Redis `unknown_sources`
  - Antrian BullMQ `"ingest"` (decoupling collector dari PostgreSQL) dengan rate limit 2000 msg/detik per perangkat & proteksi 8 KB/pesan
  - Worker ingest batch insert ke `log_events` (200 baris / 1 detik) & update `last_seen_at` dengan throttle 30 detik
  - Endpoint healthcheck collector `http://localhost:8080/health`
  - Skrip pengujian benchmark: 1000 pesan Syslog UDP + 100 pesan HTTP Ingest sukses 100% diproses ke database
- [x] **FASE 5: Parser Log Multivendor & Normalisasi**
  - Parser spesifik: MikroTik RouterOS (Winbox, SSH, firewall, dhcp, wireless, critical crash), Linux (sshd, sudo, PAM, kernel OOM, ufw), Windows Event Log (4624, 4625, 4720, 4732, 1102, 7045 via Winlogbeat/NXLog), Generic Fallback
  - Normalisasi parsed fields: `actor`, `src_ip`, `dst_ip`, `action`, `outcome`, `app`
  - Seluruh unit test parser lulus 100% (termasuk penanganan log rusak dan malformed JSON)
- [x] **FASE 6: Rule Engine Deteksi Serangan**
  - Evaluasi 8 skenario serangan otomatis setiap 30 detik: `brute_force_login`, `password_spray`, `success_after_failures`, `port_scan`, `new_admin_account`, `log_cleared`, `config_changed`, `device_silent`
  - Deduplikasi insiden pintar (satu insiden terbuka per entitas utama) + bukti maks 20 event log
  - Dukungan IP Allowlist dinamis dan ambang batas yang dapat dikonfigurasi di `/pengaturan`
- [x] **FASE 7: Modul Analisa Keamanan AI & Ringkasan Harian**
  - Integrasi antarmuka provider fleksibel (Anthropic, OpenAI, Ollama, Mock)
  - Analisa otomatis insiden severity high/critical dan analisa manual via UI
  - Agregasi data aman: masking kredensial/token/password sebelum dikirim ke AI
  - Keluaran terstruktur JSON dengan validasi Zod & saran perintah mitigasi sesuai tipe perangkat
- [x] **FASE 8: Seluruh Halaman Dashboard & Navigasi Lengkap**
  - Halaman Ringkasan `/` dengan kartu metrik, volume per jam, dan insiden terbaru
  - Halaman Perangkat `/perangkat` dan Detail `/perangkat/[id]` (Ringkasan, Event Log cursor pagination & live polling, Insiden, Analisa AI, Panduan Konfigurasi)
  - Halaman Insiden Lintas Perangkat `/insiden` dan Pengaturan `/pengaturan`
- [x] **FASE 9: Polesan UI Manusiawi (Human-Designed Light Theme)**
  - Palet warna hangat ramah mata: `#FAFAF8`, `#FFFFFF`, `#E6E4DF`, `#1F2430`, `#5B6270`
  - Zero emoji pada elemen fungsional antarmuka, font JetBrains Mono untuk IP & waktu
  - Format angka dan waktu lokal Indonesia (WIB) dengan tooltip waktu absolut
- [x] **FASE 10: Docker Production & Deployment Coolify Ready**
  - Multi-stage Dockerfile (`node:22-alpine`, Next.js standalone, user non-root)
  - Docker Compose production dengan volume persistensi PostgreSQL & Redis, capability `NET_RAW`
  - Migrasi otomatis saat startup container (`npx tsx shared/src/migrate.ts && npx tsx shared/src/seed.ts`)
  - Endpoint healthcheck `/api/health` terhubung ke orchestrator Coolify
  - Pengujian end-to-end full pipeline lulus 100%
- [x] **FASE 11: Audit Keamanan Akhir, Typecheck & Uji Beban 2000 msg/s**
  - Typecheck strict TypeScript: 0 error (`npx tsc --noEmit`)
  - Seluruh pengujian unit test (73/73 pengujian) lulus 100%
  - Audit SQL Injection (100% parameterized), XSS escaping, dan proteksi kebocoran rahasia
  - Uji beban throughput: 120.000 pesan syslog UDP dikirim selama 60 detik (throughput 2.000 msg/detik) dengan stabilitas memori tanpa crash

---

## Menjalankan di Lokal (Pengembangan)

### 1. Prasyarat
- Node.js 20+ (disarankan Node.js 22 LTS)
- PostgreSQL 16 & Redis 7 (bisa dijalankan via Homebrew atau `docker compose -f docker-compose.dev.yml up -d`)

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Konfigurasi Lingkungan
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Sesuaikan `DATABASE_URL` dan `REDIS_URL` jika menggunakan kredensial khusus.

### 4. Menjalankan Layanan Database (Bila Menggunakan Docker)
```bash
docker compose -f docker-compose.dev.yml up -d
```

### 5. Migrasi dan Seed Database
```bash
npm run db:generate   # Generate skema migrasi jika ada perubahan skema
npm run db:migrate    # Terapkan migrasi ke database PostgreSQL
npm run db:seed       # Buat user admin awal & pengaturan default
```

### 6. Menjalankan Unit Test
```bash
npm test
```

### 7. Menjalankan Aplikasi Web
```bash
npm run dev
```
Buka browser di `http://localhost:3000`. Cek status sistem di `http://localhost:3000/api/health`.

---

## Fitur Pemantauan Status Perangkat (Monitoring & Alerting)

JagaLog dilengkapi dengan worker pemantauan status perangkat cerdas (setiap 30 detik):
1. **Deteksi 4 Status Perangkat**:
   - `Online`: Log diterima secara aktif dalam batas ambang waktu (`offline_after_minutes`, default 10 menit).
   - `Log Berhenti`: Ping server berhasil merespons tetapi tidak ada log baru yang dikirimkan (indikasi rsyslog/logging router mati).
   - `Offline`: Tidak ada log baru dan ping ICMP/TCP gagal/timeout (indikasi perangkat mati total atau jaringan putus).
   - `Belum ada data`: Perangkat baru didaftarkan dan belum pernah mengirim log atau merespons ping.
2. **Debounce 2 Siklus**: Mencegah flapping notifikasi akibat lonjakan latency sementara.
3. **Notifikasi Otomatis**:
   - Dukungan **Telegram Bot API** (format Markdown rapi dengan detail IP, durasi, dan rekomendasi).
   - Dukungan **Email SMTP** (Nodemailer, port 587/465, STARTTLS/TLS).
   - Cooldown 30 menit per perangkat untuk mencegah spam saat router restart berulang kali.
   - Enkripsi kredensial channel dengan **AES-256-GCM** menggunakan `ENCRYPTION_KEY`.
4. **Visualisasi Uptime & Timeline 7 Hari**:
   - Uptime 24 Jam dan 7 Hari dihitung secara presisi dari riwayat transisi status.
   - 42-slot timeline interaktif (interval 4 jam) dengan indikator warna status.

---

## Panduan Pengiriman Log ke Server

Panduan lengkap mengenai cara menghubungkan perangkat jaringan ke JagaLog (Coolify, MikroTik RouterOS, Linux, dan Windows Server) telah dicatat secara rinci di:
👉 **[PANDUAN_PENGIRIMAN_LOG.md](file:///Users/yahyahidayatullah/Library/CloudStorage/OneDrive-SharedLibraries-onedrive/SYSTEM_APLIKASI/JAGALOG_APPS/PANDUAN_PENGIRIMAN_LOG.md)**

---

## Deploy ke Coolify (Ringkasan)

1. Buat Resource **Docker Compose** di Coolify dan arahkan ke branch `main`.
2. Masukkan semua Environment Variables wajib yang tercantum di `.env.example` (centang **Secret** untuk password, encryption key, dan token).
3. Arahkan domain ke service `app` (port 3000).
4. Buka port `5514/udp` dan `5514/tcp` di firewall server untuk container `collector` (Port Mappings `5514:5514`).
5. Pastikan capability `NET_RAW` aktif pada container collector/worker untuk ICMP ping.

---

## Pemeliharaan Sistem & Pengelolaan Disk

Untuk menjaga agar database dan memori server tidak membengkak seiring bertambahnya log:

### 1. Perintah Pemeriksaan Ukuran & Status
```bash
# Cek ukuran database PostgreSQL dan tabel terbesar
npx tsx -e "
import { db } from './shared/src/db.js';
import { sql } from 'drizzle-orm';
const res = await db.execute(sql\`SELECT pg_size_pretty(pg_database_size(current_database())) as db_size;\`);
console.log('Database Size:', res[0]?.db_size);
process.exit(0);
"

# Cek memori Redis
npx tsx -e "
import { redis } from './shared/src/redis.js';
const mem = await redis.info('memory');
console.log(mem.split('\r\n').filter(l => l.startsWith('used_memory_human') || l.startsWith('maxmemory_human')).join('\n'));
process.exit(0);
"

# Cek ruang disk server
df -h
```

### 2. Pembersihan Data Uji & Artefak Pengembangan
```bash
# Dry-run pengecekan data uji di database (tanpa menghapus)
npm run clean:test-data

# Eksekusi pembersihan data uji bertahap (batch 5.000) & VACUUM FULL
npm run clean:test-data:apply

# Pembersihan artefak build Next.js lokal (.next)
npm run clean:dev

# Pembersihan retensi log otomatis harian (default 30 hari)
npm run cleaner
```

### 3. Rotasi Log & Retensi
- **Retensi Log Aplikasi**: Dikelola secara otomatis setiap hari via BullMQ repeatable job (`shared/src/cleaner.ts`) berdasarkan nilai `LOG_RETENTION_DAYS` (default 30 hari).
- **Rotasi Log Docker**: Seluruh layanan di `docker-compose.yml` telah dipasangi batas rotasi file log `max-size: 10m` dan `max-file: 3` (maksimal 30 MB per kontainer).

---

## Pembaruan Langsung (Server-Sent Events / SSE)

JagaLog dilengkapi dengan lapisan pembaruan langsung berbasis **Server-Sent Events (SSE)** via endpoint `GET /api/stream` dan **Redis Pub/Sub** (`jagalog:changes`), sehingga data di UI (status perangkat, latensi ping, log baru, insiden, dan grafik riwayat) diperbarui secara real-time tanpa memerlukan refresh halaman penuh dan tanpa membebani server dengan polling berulang.

### Cara Kerja
1. **Penerbitan Event Ringkas**: Ketika data berhasil disimpan/di-commit ke database (log masuk, status perangkat berubah, ping berhasil dicatat, atau insiden dibuat), server menerbitkan event delta ringkas (< 500 byte) ke kanal Redis `jagalog:changes`.
2. **Coalescing Lonjakan Log**: Untuk lonjakan pesan log berkecepatan tinggi (hingga 3.000 pesan/detik), event `log.baru` dikelompokkan (*coalesced*) per perangkat dalam jendela 1–2 detik sehingga hanya menghasilkan paling banyak 1 event per perangkat per detik.
3. **Broker SSE Terpusat**: Setiap instance server aplikasi mengelola satu koneksi subscriber Redis bersama yang menyalurkan event ke semua tab klien yang terhubung sesuai izin dan filter aktif.
4. **Resync & Last-Event-ID**: Buffer 60 detik terakhir disimpan di Redis sorted set. Jika koneksi terputus sesaat, klien menyambung ulang dengan `Last-Event-ID` untuk menerima event yang terlewat tanpa reload; jika terputus terlalu lama, server mengirimkan sinyal `resync` untuk memperbarui tampilan aktif.
5. **Cadangan (Fallback Polling)**: Jika koneksi SSE gagal 3 kali berturut-turut (misal proxy memblokir streaming), sistem otomatis beralih ke polling ringan setiap 15 detik untuk tampilan aktif, dan mencoba menyambung kembali ke SSE setiap 2 menit.
6. **Batas Koneksi**: Maksimal 5 koneksi per pengguna dan 200 koneksi per instance untuk menjaga stabilitas memori.

### Menonaktifkan Pembaruan Langsung
Jika diinginkan untuk mematikan fitur pembaruan langsung dan mengembalikan ke mode statis:
```bash
# Tambahkan variabel lingkungan ini di file .env atau konfigurasi Coolify:
LIVE_UPDATES=false
```

### Catatan Konfigurasi Reverse Proxy (Traefik / Coolify / Cloudflare)
- **Header SSE**: Endpoint `/api/stream` mengirimkan header `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, dan `Content-Encoding: none`.
- **Heartbeat**: Server mengirimkan komentar `: ping\n\n` setiap 20 detik untuk mencegah reverse proxy memutus koneksi akibat idle timeout.
- **Traefik / Coolify**: Tidak diperlukan service tambahan. Traefik secara otomatis menghormati header `X-Accel-Buffering: no`.
- **Cloudflare**: Jika domain diarahkan melalui Cloudflare Proxy (orange cloud), buffer Cloudflare dapat menahan streaming SSE. Jika hal tersebut terjadi, mekanisme fallback polling otomatis aktif dengan interval 15 detik tanpa mengganggu pengalaman pengguna.

---

## Sakelar Pengaman (Kill Switch) & Diagnostik Sistem

### 1. Sakelar Pengaman Dashboard (`DASHBOARD_FAST_PATH`)
JagaLog menyediakan sakelar pengaman lingkungan (*kill switch*) untuk pemuatan data ringkasan dashboard (`/`):
- Secara default, `DASHBOARD_FAST_PATH` bernilai `true` (memakai jalur teroptimasi dengan isolasi per bagian `Promise.allSettled`, multi-tier fallback cache segar -> basi -> hitung agregasi, dan pelindung stampede).
- Jika terjadi anomali atau ingin mengembalikan perilaku endpoint ringkasan ke versi sebelum optimasi secara instan tanpa perlu deploy ulang kode, set variabel lingkungan di `.env` atau Coolify:
```bash
DASHBOARD_FAST_PATH=false
```
Ketika bernilai `false`, endpoint akan mematikan mekanisme warm-up dan bypass proteksi stampede, mengeksekusi sub-query secara langsung untuk memastikan ketersediaan data.

### 2. Panel Diagnostik & Endpoint Admin
Tersedia endpoint khusus administrator:
- `GET /api/admin/diagnostik` (dilindungi otorisasi *fail-closed* hanya untuk peran `admin`, hasil di-cache 10 detik di Redis).
- Menyajikan metrik real-time:
  - **PostgreSQL**: Latensi query, jumlah koneksi aktif vs batas (`max_connections`), dan transaksi yang menunggu lock.
  - **Redis Cache**: Latensi ping, pemakaian memori (`used_memory`) vs `maxmemory`, kebijakan eviksi (`maxmemory-policy`), dan total kunci.
  - **Antrian BullMQ Ingest**: Jumlah antrean `waiting`, `active`, `failed`, dan `completed`.
  - **Penyimpanan Disk Server**: Persentase kapasitas disk terpakai dan sisa ruang GB.
  - **Probe Sub-Query Dashboard**: Uji ringan respons per bagian (`devices`, `incidents`, `hourlyChart`).
  - **Status Limit & Build**: Konfigurasi batas aktif dan versi build.
- Antarmuka visual dapat diakses langsung oleh admin pada menu **Pengaturan (`/pengaturan`) -> Bagian 8. Kesehatan Sistem**.


