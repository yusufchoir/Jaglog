TUGAS: Setelah perubahan optimasi (grafik volume log + percepatan Dashboard dan Event
Log), memuat ulang halaman Dashboard (/) menjadi JAUH LEBIH LAMA dari sebelum perubahan:
halaman berputar lama sebelum data tampil. Ini regresi. Pulihkan kecepatan minimal
setara kondisi SEBELUM perubahan, lalu capai target. Hanya perbaiki ini.

ATURAN KERAS (wajib dipatuhi)
- PRIORITAS: kembalikan kecepatan. Jangan menambah fitur baru. Jangan mengubah fitur,
  tampilan, perhitungan, aturan deteksi, parser, atau endpoint yang tidak terkait.
  Respons endpoint lama tidak berubah. Tema dan gaya tetap (terang, garis tipis
  biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia).
- Ukur dulu, baru ubah. Setiap perubahan harus dibuktikan dengan angka sebelum/sesudah
  di build production, bukan mode dev.
- Bila sebuah optimasi terbukti memperlambat dan tidak bisa diperbaiki cepat, MATIKAN
  atau KEMBALIKAN bagian itu (mis. lewat feature flag) dan laporkan. Kecepatan lebih
  penting daripada mempertahankan optimasi tertentu.
- Jangan menghapus data. Backup (pg_dump) sebelum mengubah data/indeks. Migrasi aditif,
  idempoten. Pembuatan indeks memakai CREATE INDEX CONCURRENTLY dan tidak mengunci
  tabel. Tidak ada tabel/worker/job duplikat, tidak ada fetch ganda, tidak ada
  alert/confirm bawaan browser. Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS TERUKUR (jangan ubah kode dulu)
A. Ukur di build production (cache browser nonaktif, lalu cache aktif), dan bandingkan
   dengan commit SEBELUM perubahan optimasi (checkout commit itu di lingkungan terpisah
   atau pakai data baseline yang sudah ada):
   - Waktu sampai kerangka halaman tampil, sampai data lengkap, TTFB, LCP.
   - Waterfall request: urutan, durasi, status "pending" vs "waiting", ukuran respons.
   - Jumlah koneksi yang terbuka ke domain (SSE, prefetch, polling) dan apakah request
     data tertahan menunggu slot koneksi browser.
   - Header Server-Timing (DB, cache, total) tiap endpoint dashboard.
B. Server dan database:
   - pg_stat_activity saat halaman dimuat: query yang berjalan lama, status "waiting",
     kunci (pg_locks), sesi "idle in transaction", jumlah koneksi vs max_connections
     dan ukuran pool tiap service (app, worker, collector).
   - pg_stat_statements: 10 query teratas (total_exec_time, calls, mean_exec_time),
     khususnya query agregasi baru. EXPLAIN (ANALYZE, BUFFERS) untuk tiap query
     dashboard; tandai Seq Scan, Sort besar, Hash Join besar, dan penggunaan tabel
     log_events untuk angka yang seharusnya dari agregasi.
   - Apakah backfill agregasi, pembuatan indeks, VACUUM/autovacuum, atau job retensi
     sedang berjalan dan memakai CPU/IO. Tampilkan statusnya dan lamanya.
   - Redis: latensi (redis-cli --latency), memori, jumlah key, hit/miss cache, antrian
     BullMQ yang menumpuk, dan apakah Redis dapat menjadi hambatan.
   - CPU/memori tiap container (app, worker, collector, postgres, redis) saat halaman
     dimuat.
C. Kode:
   - Pelindung stampede/kunci cache: apakah ada penantian tanpa batas waktu (lock
     tidak pernah dilepas, TTL kunci terlalu panjang, pembangun cache gagal sehingga
     yang lain menunggu selamanya).
   - Apakah jalur "cache hit" masih menjalankan query DB, dan apakah jalur "cache miss"
     dijalankan berkali-kali bersamaan.
   - Warm-up saat start: apakah memblokir startup atau dijalankan di setiap request.
   - Struktur Suspense/streaming: apakah satu widget lambat menahan seluruh halaman;
     apakah Promise.all menunggu query paling lambat; apakah ada waterfall (data
     dependen berantai).
   - Prefetch dan SSE: jumlah koneksi, prefetch yang terlalu agresif, polling yang
     masih berjalan bersamaan dengan SSE.
   - Grafik baru: loop render, perhitungan berat di render, data besar, library yang
     dimuat di jalur kritis.
   - Service worker dan cache klien: apakah menyajikan aset lama atau menahan
     permintaan.
D. Tabel akar masalah berurutan dari kontribusi terbesar (ms), dengan file:baris dan
   bukti, serta perbandingan sebelum vs sesudah perubahan optimasi.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN (sesuai bukti Langkah 1; prinsip di bawah wajib)

A. Jalur kritis tidak boleh pernah menunggu tanpa batas
- Setiap penantian (kunci cache, Redis, DB) punya timeout tegas: Redis <= 200 ms, kunci
  cache <= 300 ms, query dashboard <= 3 detik (statement_timeout di sesi), dan bila
  timeout terjadi: lanjut ke jalur cadangan (hitung langsung dari agregasi dengan
  query ringan, atau tampilkan data cache terakhir yang basi) dan catat peringatan di
  log. Jangan menggantung.
- Pelindung stampede: satu pembangun dengan kunci ber-TTL pendek (<= 10 detik) dan
  pelepasan pada finally; pengguna lain yang menunggu maksimal 300 ms lalu memakai data
  basi atau membangun sendiri. Tidak ada kunci yang bisa tertahan selamanya.
- Redis tidak tersedia atau lambat: aplikasi tetap berfungsi tanpa cache (degradasi
  anggun), tidak berputar tanpa akhir.

B. Halaman tidak diblokir oleh satu bagian lambat
- Kerangka halaman, navigasi, dan skeleton muncul seketika. Setiap widget (kartu
  ringkasan, grafik, daftar perangkat, insiden terbaru, peta pratinjau) memuat datanya
  sendiri dan tampil begitu siap, masing-masing dalam batas Suspense sendiri dengan
  error boundary sendiri. Widget lambat tidak menahan widget lain. Bila satu widget
  melewati 3 detik, tampilkan "Memuat lebih lama dari biasa" dengan tombol Coba Lagi,
  bukan putaran tanpa akhir.
- Hilangkan waterfall: request independen dimulai bersamaan.
- Tampilkan data cache terakhir lebih dulu (stale-while-revalidate) lalu perbarui
  diam-diam; tidak ada layar kosong saat refresh.

C. Koneksi dan beban
- Batasi koneksi di browser: satu koneksi SSE per tab; prefetch dibatasi (hanya saat
  idle, maksimal 2 bersamaan, tidak saat memuat dashboard); tidak ada polling yang
  tumpang tindih dengan SSE. Bila domain melayani HTTP/1.1, pastikan HTTP/2 aktif di
  proxy (Traefik/Coolify) agar tidak terkena batas 6 koneksi; laporkan statusnya.
- Pool koneksi Postgres sesuai kebutuhan: total semua service di bawah max_connections
  dengan sisa untuk admin; tidak ada kebocoran koneksi atau transaksi menggantung.

D. Pekerjaan latar belakang tidak boleh mengganggu pengguna
- Backfill agregasi, pembuatan indeks, dan job berat berjalan dengan throttle (batch
  kecil, jeda antar batch, prioritas rendah) dan di luar jam sibuk, tidak mengunci
  tabel yang dipakai dashboard. Jika masih berjalan, tunggu atau jadwalkan ulang dan
  jelaskan.
- Warm-up setelah start berjalan ASINKRON dan tidak memblokir server menerima request;
  hanya memanaskan satu kali, tidak berulang.

E. Query dan indeks
- Perbaiki query agregasi baru yang lambat sesuai EXPLAIN: indeks yang cocok dengan
  filter dan urutan (CONCURRENTLY), hapus join/sort yang tidak perlu, baca dari tabel
  agregasi (bukan log_events) untuk semua angka ringkasan, dan batasi jendela waktu.
  Jam berjalan memakai agregasi inkremental atau cache pendek, bukan scan penuh.
- Jalankan ANALYZE pada tabel terdampak agar perencana query memakai statistik baru.

F. Grafik dan klien
- Perhitungan ringkasan dan penjelasan otomatis dilakukan di server (sekali, di-cache),
  bukan berulang di render. Komponen grafik di-memo dan dimuat dinamis (bukan di jalur
  kritis). Perbaiki loop render bila ada.
- Service worker tidak boleh menahan atau menyajikan data lama untuk HTML/API; aset
  berhash cache-first, HTML dan API network-only.

G. Kembalikan atau matikan yang memperlambat
- Bagian optimasi yang terbukti memperlambat dan tidak dapat diperbaiki cepat: matikan
  lewat feature flag (env) atau kembalikan, dan laporkan alasannya. Jangan memaksakan.

H. Pengamat kinerja (ringan, tanpa data sensitif)
- Header Server-Timing pada endpoint utama (waktu DB, cache, total) dan log peringatan
  untuk request > 1 detik (path, durasi, rincian). Hanya admin yang melihat rincian.
- Tes otomatis anggaran performa: jumlah request, jumlah query, batas waktu per halaman;
  gagal bila terlampaui.

LANGKAH 3 - TES (tampilkan hasilnya, build production)
- Tabel PERBANDINGAN TIGA KEADAAN: (1) sebelum perubahan optimasi, (2) setelah
  perubahan optimasi (kondisi lambat), (3) setelah perbaikan ini: waktu kerangka
  tampil, waktu data lengkap, p50/p95, jumlah request, jumlah query, ukuran respons,
  untuk /, Event Log, dan tab Ringkasan perangkat. Hasil akhir HARUS lebih cepat
  daripada keadaan (1). Bila belum, jelaskan penyebabnya dan matikan bagian terkait.
- Target p95 (seed 5 juta baris log dan 20 perangkat): kerangka < 200 ms, Dashboard data
  lengkap < 500 ms, Event Log 24 jam < 600 ms, dengan pencarian teks dan filter waktu
  < 800 ms.
- Skenario: cache dingin, cache hangat, setelah restart/deploy, Redis dimatikan,
  Redis lambat (latensi buatan 2 detik), satu query dibuat lambat (sleep 5 detik),
  backfill sedang berjalan, 100 refresh berturut-turut dan 20 pengguna bersamaan,
  lonjakan 3000 log/detik. Pada semua skenario: halaman tidak berputar tanpa akhir,
  widget lain tetap tampil, kegagalan menampilkan pesan dengan Coba Lagi.
- Refresh berulang 30 kali: waktu tidak bertambah lambat, tidak ada kebocoran koneksi
  atau memori (periksa pg_stat_activity, memori app, jumlah koneksi Redis).
- Tab tersembunyi/kembali, mobile 390 px, mode PWA/service worker, dan browser lain.
- Regresi: semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan 390
  px), grafik volume log tetap benar (angka sama dengan agregasi), respons endpoint lama
  identik, lint, typecheck, seluruh tes lama lulus.

LAPORAN AKHIR (wajib)
- Akar masalah berurut kontribusi (ms), apa yang diperbaiki/dimatikan, tabel tiga
  keadaan, daftar file/migrasi yang diubah, lokasi backup, konfirmasi tertulis bahwa
  fitur lain tidak berubah, dan sisa risiko yang diketahui.