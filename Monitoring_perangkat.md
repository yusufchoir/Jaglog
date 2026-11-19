TAMBAHAN: Monitoring status perangkat (online/offline).

1. Database
- Tambah kolom di devices: offline_after_minutes (int, default 10),
  ping_enabled (bool, default false), last_ping_at, last_ping_ok (bool),
  status (enum: online, log_stopped, offline, unknown), status_changed_at.
- Tabel device_status_history: id, device_id FK, status, started_at, ended_at.
- Tabel notification_channels: id, type (telegram|email), config (terenkripsi),
  is_active. Tabel notification_log untuk mencatat pengiriman.

2. Worker status (tiap 30 detik)
- Hitung status tiap perangkat aktif:
  * online: log masuk dalam offline_after_minutes terakhir
  * log_stopped: tidak ada log, TAPI ping berhasil (hanya jika ping_enabled)
  * offline: tidak ada log dan ping gagal (atau ping tidak aktif)
  * unknown: belum pernah mengirim log
- Ping opsional: ICMP atau fallback TCP check ke IP perangkat, timeout 2 detik,
  3 percobaan, hanya untuk perangkat ping_enabled. Batasi concurrency 20.
- Saat status berubah: tutup baris riwayat lama, buat baris baru, update
  status_changed_at, buat/update insiden device_silent.
- Gunakan debounce: status baru harus bertahan 2 siklus berturut-turut sebelum
  dianggap berubah, agar tidak berkedip.

3. Notifikasi
- Kirim Telegram (bot token + chat id) dan/atau email SMTP saat perangkat
  offline dan saat pulih, berisi nama perangkat, durasi, dan link ke dashboard.
- Batasi: maksimal 1 notifikasi per perangkat per 30 menit untuk perubahan yang
  sama. Rahasia channel disimpan terenkripsi. Tombol "Kirim tes" di pengaturan.

4. UI (ikuti aturan tampilan terang, garis merah/biru tipis, tanpa emoji)
- Badge status dengan label teks: Online, Log berhenti, Offline, Belum ada data.
- Di tabel Perangkat dan kartu dashboard: status + "offline sejak 14 menit lalu".
- Di detail perangkat tab Ringkasan: garis waktu status 7 hari (blok tipis
  hijau/abu/merah, atau biru/abu/merah sesuai tema) dan persentase uptime 24 jam/7 hari.
- Di form perangkat: field "Dianggap offline setelah (menit)" dan toggle
  "Cek ping dari server" dengan penjelasan singkat bahwa server harus bisa
  menjangkau IP perangkat.
- Di panel "Cara mengirim log": tambahkan contoh heartbeat untuk MikroTik
  (scheduler) dan Linux (cron logger).
- Halaman /pengaturan: kelola channel notifikasi dan tombol tes.

5. Docker
- Jika memakai ICMP, tambahkan cap_add NET_RAW pada service worker di
  docker-compose.yml dan jelaskan di README bagian Coolify. Sediakan fallback TCP.

6. Tes
- Simulasikan perangkat berhenti kirim log, ping hidup, lalu ping mati,
  dan tunjukkan perubahan status, riwayat, insiden, dan notifikasi uji.

  Contoh heartbeat MikroTik:

/system scheduler
add name=jagalog-heartbeat interval=1m on-event=":log info \"heartbeat jagalog\""

Contoh heartbeat Linux (cron):

* * * * * logger -t jagalog "heartbeat"