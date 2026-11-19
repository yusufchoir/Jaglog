TUGAS: Lengkapi fitur notifikasi saat ping RTO pada JagaLog, dengan MEMAKAI ULANG
yang sudah ada. Jangan membuat ulang tabel, worker, halaman, atau komponen yang
sudah ada. Jangan mengubah desain, tema, atau fitur lain.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Periksa kode saat ini lalu laporkan, untuk tiap butir: ADA / SEBAGIAN / BELUM,
beserta file:baris.
a. Kolom ping di tabel devices (ping_enabled, interval, status, last_ping_at, RTT).
b. Worker ping dan logika status online/offline/RTO (termasuk debounce).
c. Insiden untuk perangkat tidak terjangkau (device_silent atau ping_rto).
d. Sistem notifikasi: channel (Telegram/email), antrian kirim, tombol "Kirim tes",
   riwayat pengiriman.
e. Hook/komponen mutasi bersama (loading, toast, penanganan error).
f. Halaman pengaturan, kartu dashboard, dan badge status yang sudah menampilkan status.
g. cap_add NET_RAW atau fallback TCP di docker-compose.
Berhenti dan tunggu "lanjut" setelah laporan.

LANGKAH 2 - LENGKAPI HANYA YANG KURANG
Kerjakan hanya butir yang berstatus BELUM atau SEBAGIAN. Aturannya:

1. Pemicu RTO
- Gunakan logika status ping yang sudah ada. Jika belum ada, tambahkan di worker
  yang sudah ada (bukan worker baru): RTO setelah N kegagalan berturut-turut
  (default 3), pulih setelah 2 sukses berturut-turut.
- Perubahan status menghasilkan SATU event: ping_rto atau ping_recovered.
- Pakai insiden yang sudah ada untuk perangkat tidak terjangkau. Jangan buat
  insiden kedua untuk kejadian yang sama (satu insiden terbuka per perangkat).

2. Pengiriman notifikasi
- Pakai channel dan antrian notifikasi yang sudah ada. Jika belum ada sama sekali,
  buat versi minimal: satu tabel notification_channels (Telegram dan email, config
  terenkripsi), satu antrian "notify" dengan retry, dan tombol "Kirim tes".
- Isi pesan: nama perangkat, IP, waktu mulai (WIB), durasi (untuk pulih), dugaan
  penyebab, dan link ke /perangkat/{id}.
  Dugaan penyebab dari korelasi dengan log:
  * RTO + log berhenti -> "Perangkat mati atau jaringan putus"
  * RTO + log masih masuk -> "Ping diblokir, perangkat masih hidup"
  * Ping normal + log berhenti -> "Layanan pengirim log berhenti"
- Anti-spam: satu notifikasi per kejadian, pengingat hanya bila masih RTO (setelah
  30 menit lalu tiap 2 jam), dan perangkat yang bolak-balik lebih dari 4 kali dalam
  30 menit hanya memicu satu pesan "tidak stabil" lalu ditahan 30 menit.
- Kegagalan kirim dicatat dan tidak boleh menghentikan worker ping.
- Jangan sertakan token atau password dalam pesan.

3. UI (gunakan komponen, gaya, dan hook mutasi yang sudah ada)
- Pada pengaturan perangkat yang sudah ada: tambahkan hanya opsi yang belum ada
  (ambang gagal berturut-turut, toggle "kirim notifikasi RTO untuk perangkat ini").
- Pada halaman pengaturan yang sudah ada: tambahkan bagian Notifikasi hanya jika
  belum ada (channel, tombol tes, pilihan event ping_rto dan ping_recovered).
- Tampilkan "RTO sejak 8 menit lalu" pada badge status yang sudah ada, dan tambahkan
  daftar riwayat RTO pada tab Ringkasan perangkat jika belum ada.
- Tanpa perubahan tema. Tanpa emoji. Teks Indonesia yang spesifik.

4. Keamanan dan performa
- Panggil ping dengan argumen array tanpa shell, dan validasi IP, agar tidak ada
  command injection.
- Jangan menambah polling atau fetch baru di UI; pakai data status dari endpoint
  yang sudah ada.
- Jika memakai ICMP dan belum ada, tambahkan cap_add NET_RAW untuk worker, dengan
  fallback TCP. Catat di README bagian Coolify.

LANGKAH 3 - TES
- Unit test: gagal 1-2 kali tidak memicu RTO; gagal sesuai ambang memicu sekali;
  2 sukses memicu pulih; flapping memicu pesan ringkasan.
- Simulasi perangkat tidak terjangkau: insiden terbentuk satu kali, notifikasi
  terkirim satu kali ke channel tes, pengingat tidak dobel. Lalu simulasi pulih.
- Uji IP berisi "1.1.1.1; ls" ditolak.
- Pastikan tidak ada tabel, worker, atau job ganda (daftar job BullMQ dan skema DB
  sebelum vs sesudah).
- Jalankan lint, typecheck, dan seluruh tes yang sudah ada; pastikan tidak ada yang
  rusak. Ringkas file yang diubah dan apa yang ditambah.