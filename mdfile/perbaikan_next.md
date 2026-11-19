TUGAS: Perbaiki error yang masih terjadi setelah perubahan optimasi:
1. Detail perangkat (/perangkat/[id]) menampilkan "Gagal memuat statistik perangkat" dan
   "Perangkat tidak ditemukan", dan Console penuh GET
   /api/devices/{id}/riwayat-status?rentang=7h&skala=otomatis -> 500 (Internal Server
   Error), dikirim berulang kali.
2. Dashboard (/) menampilkan angka tidak konsisten dan kosong:
   - Donut "13 NODE" tetapi Online 0, Log Berhenti 0, Offline 0, Belum Ada Data 0.
   - Donut alarm 0 dan Kritis/Tinggi/Sedang/Rendah semua 0, padahal "Status Per Area"
     menampilkan insiden CYBER 8, PERTAMINA 1, SEMARANG 7, SINGGAPORE 1 (total 17).
   - Heatmap: "Belum ada perangkat yang terdaftar di peta", padahal ada 13 perangkat.
   - Semua kartu perangkat "Log 24 Jam: 0".
   - Grafik: "Gagal Memuat Grafik Aktivitas Log - Terjadi kesalahan saat merender bagian
     ini." (error RENDER di komponen, bukan gagal fetch).
Hanya perbaiki ini.

DUGAAN AWAL (verifikasi, jangan diasumsikan)
Tabel agregasi baru (log per jam / riwayat status) kosong, belum selesai di-backfill,
atau kolom/tabelnya belum ada di database yang dipakai, sehingga query gagal (500) atau
mengembalikan 0. Angka yang sama dihitung di lebih dari satu tempat dengan hasil berbeda.

ATURAN KERAS (wajib dipatuhi)
- Hanya memperbaiki hal di atas. Jangan mengubah fitur, tampilan, perhitungan, aturan
  deteksi, parser, atau endpoint yang tidak terkait. Respons endpoint lama tidak berubah
  (hanya aditif). Tema dan gaya tetap (terang, garis tipis biru/merah, tanpa gradient/
  glow/emoji, Bahasa Indonesia yang spesifik).
- Berbasis bukti: setiap kesimpulan harus ditunjukkan dengan pesan error server, log,
  hasil query, atau nilai konfigurasi. Reproduksi di build production dan database yang
  sama dengan yang saya pakai.
- Keamanan tidak dilonggarkan: otorisasi server fail-closed, tidak ada data sensitif di
  pesan error ke pengguna.
- Backup (pg_dump) sebelum mengubah data atau skema. Migrasi aditif dan idempoten,
  pembuatan indeks CONCURRENTLY. Tidak menghapus data tanpa persetujuan saya. Tidak ada
  tabel/worker/job duplikat, tidak ada fetch ganda, tidak ada alert/confirm bawaan.
- Bila bagian optimasi sebelumnya terbukti penyebab dan tidak bisa diperbaiki cepat,
  matikan lewat feature flag (DASHBOARD_FAST_PATH=false) dan laporkan. Ketersediaan dan
  kebenaran angka lebih penting daripada optimasi.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode atau data dulu)
A. Error 500 riwayat-status
 1. Ambil isi respons dan stack trace server untuk endpoint itu pada perangkat
    04c4beb0-0ea9-4586-97ef-9272a2f4f337 (dan satu perangkat lain). Tunjukkan SQL yang
    gagal dan pesannya (mis. relation/column does not exist, timeout, tipe data,
    pembagian nol, null tak tertangani, kegagalan validasi Zod di server).
 2. Cek status migrasi di database yang dipakai production: daftar migrasi yang sudah/
    belum berjalan, keberadaan semua tabel dan kolom yang dirujuk kode (tabel agregasi
    log per jam, riwayat status, ping, status tampilan, dan lainnya), dan apakah
    entrypoint menjalankan migrasi otomatis saat start. Bandingkan skema database
    dengan skema di kode.
 3. Jumlah baris dan rentang waktu di tiap tabel agregasi dan riwayat (log_stats_hourly
    atau setara, device_status_history, ping aggregates): terisi, kosong, atau parsial?
    Apakah backfill sudah berjalan, gagal, atau belum pernah dijalankan; apakah worker
    pengisi agregasi aktif dan tanpa error.
 4. Mengapa permintaan yang sama dikirim berulang: tunjukkan konfigurasi retry/
    refetch pada pemanggil endpoint ini dan jumlah request per detik.
 5. Mengapa 500 ditampilkan sebagai "Perangkat tidak ditemukan": telusuri pemetaan
    error di halaman detail perangkat (file:baris), dan apakah endpoint detail
    perangkat sendiri gagal atau hanya endpoint statistik.
B. Dashboard tidak konsisten
 1. Untuk setiap widget (donut status node, donut alarm, heatmap, Status Per Area,
    kartu perangkat "Log 24 Jam", kartu ringkasan atas, grafik volume log) tampilkan:
    endpoint/fungsi sumber, query SQL, tabel yang dibaca, dan nilai yang dikembalikan
    sekarang. Tandai widget yang membaca sumber berbeda untuk data yang sama
    (status perangkat, insiden terbuka, log 24 jam).
 2. Jalankan langsung di database dan bandingkan: jumlah perangkat per status,
    jumlah insiden terbuka per severity dan per grup, jumlah log 24 jam per perangkat
    (dari log_events dan dari tabel agregasi). Tunjukkan selisihnya.
 3. Heatmap: mengapa "belum ada perangkat di peta" (sumber data peta, topology_nodes,
    filter, atau kegagalan fetch). Donut status: mengapa semua kategori 0 (query
    mengembalikan apa).
 4. Grafik: tangkap exception render sebenarnya (pesan, stack, bentuk data yang
    diterima komponen: null/undefined, NaN, array kosong, tipe string vs angka,
    BigInt/Decimal diserialisasi sebagai string, field baru yang hilang). Tunjukkan
    file:baris.
 5. Apakah error boundary grafik menampilkan pesan yang sama untuk error fetch dan
    error render (harus dibedakan).
C. Akar masalah: urutkan berdasarkan kontribusi, dengan bukti. Jelaskan apakah satu
   penyebab (mis. agregasi kosong/skema belum termigrasi) menjelaskan semua gejala atau
   ada beberapa penyebab terpisah.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN (sesuai bukti Langkah 1; prinsip wajib)

A. Pulihkan data sumber
 - Skema: jalankan/perbaiki migrasi yang belum berjalan dan pastikan entrypoint
   menjalankannya otomatis, idempoten, dengan healthcheck yang gagal bila skema tidak
   sesuai (aplikasi tidak melayani halaman dengan skema salah).
 - Agregasi kosong/parsial: jalankan backfill yang aman dan bertahap dari data mentah
   yang masih ada (batch kecil, jeda antar batch, prioritas rendah, tidak mengunci
   tabel, dapat dilanjutkan, ada indikator progres dan log). Pastikan worker pengisi
   agregasi aktif, idempoten, dan angka agregasi SAMA dengan hitungan dari log mentah
   untuk rentang yang sama (uji pencocokan).
 - Selama agregasi belum lengkap untuk suatu rentang: baca dari jalur lama (log mentah
   dengan batas waktu dan indeks yang benar) atau tampilkan keadaan "Sedang menyiapkan
   data" dengan persentase progres; JANGAN menampilkan 0 sebagai angka sungguhan.
 - Bila penyebabnya bukan agregasi, perbaiki akar masalah yang terbukti.

B. Endpoint riwayat-status tidak boleh menghasilkan 500 karena data kosong
 - Perangkat tanpa riwayat, tabel kosong, atau rentang tanpa data harus mengembalikan
   200 dengan slot "Belum Ada Data" dan ringkasan "-", bukan 500.
 - Kesalahan tak terduga menghasilkan respons error terstruktur (kode, pesan aman,
   id referensi) dan dicatat di log server dengan stack.
 - Setiap bagian respons (bar status utama, baris ping, baris pengiriman log, ringkasan)
   dihitung terpisah; satu bagian gagal tidak membatalkan bagian lain (status per
   bagian: ok | gagal | tanpa_data).

C. Satu sumber kebenaran untuk angka dashboard
 - Semua widget (donut status, donut alarm, heatmap, Status Per Area, kartu perangkat,
   kartu ringkasan atas, "Log 24 Jam", grafik) membaca dari SATU fungsi/endpoint
   "ringkasan armada" (yang sama dengan halaman Perangkat, Grup, dan Peta). Hapus
   perhitungan paralel yang berbeda.
 - Invarian yang HARUS selalu benar dan diuji otomatis:
   1. jumlah semua status (online + log berhenti + offline + belum ada data) = total node,
   2. total alarm di donut = jumlah insiden terbuka = jumlah insiden per area +
      insiden tanpa grup,
   3. rincian per severity menjumlah ke total alarm,
   4. jumlah "Log 24 Jam" semua perangkat = Total 24 Jam di grafik = jumlah log di
      Event Log untuk rentang yang sama (toleransi jam berjalan),
   5. jumlah perangkat di heatmap = jumlah perangkat aktif,
   6. "X dari Y online" per area = jumlah status online anggota area itu = hitungan
      donut.
 - Heatmap membaca perangkat dari sumber perangkat (bukan hanya dari node peta), jadi
   perangkat yang belum ditempatkan di peta tetap tampil di heatmap.
 - Bila satu widget gagal, tampilkan "-" dan pesan lokal dengan "Coba Lagi"; jangan
   menampilkan 0 yang menyesatkan dan jangan menurunkan angka widget lain.

D. Grafik: perbaiki error render
 - Normalisasi data sebelum dirender: konversi string ke angka, NaN/Infinity -> 0 atau
   dibuang, null -> "-" , array kosong -> keadaan kosong yang benar, dan validasi
   bentuk dengan Zod; entri tidak valid dibuang dan dicatat, bukan membuat render gagal.
 - Error boundary grafik membedakan: "Gagal memuat data" (fetch, dengan Coba Lagi),
   "Data tidak dapat ditampilkan" (render, dengan id referensi dan pelaporan ke
   /api/client-error), dan "Belum ada log pada 24 jam terakhir" (HANYA bila pengecekan
   sukses dan nilainya benar-benar nol).

E. Detail perangkat
 - "Perangkat tidak ditemukan" HANYA untuk respons 404 yang sebenarnya. Error 5xx/
   timeout menampilkan "Gagal memuat data perangkat" dengan Coba Lagi dan id referensi.
 - Header perangkat (nama, IP, status) tetap tampil bila hanya statistik yang gagal;
   tiap bagian detail perangkat (ringkasan, riwayat status, ping, pengiriman log, Event
   Log) punya boundary dan status error sendiri.
 - Pastikan ID perangkat valid yang ada di database diperlakukan benar (bukan salah
   deteksi format/izin).

F. Batas retry di SEMUA pemanggil
 - Satu konfigurasi retry terpusat untuk semua query klien: maksimal 2 kali dengan
   backoff dan jitter, 4xx tidak di-retry, 401 ke login sekali, circuit breaker
   (3 kegagalan -> 30 detik) berlaku untuk setiap endpoint (termasuk riwayat-status),
   dan tidak ada permintaan otomatis berulang tanpa batas. Pemicu manual "Coba Lagi"
   selalu bisa.

G. Pemeriksa konsistensi (hanya baca)
 - Perluas `npm run check:data`: periksa invarian C, kelengkapan agregasi vs log mentah
   (selisih per jam), skema vs migrasi, dan tabel/kolom yang dirujuk kode. Laporan
   ringkas dengan status lulus/gagal.
 - Tampilkan hasil ringkasnya di /pengaturan > "Kesehatan sistem" (admin saja):
   status migrasi, kelengkapan agregasi (persen, rentang), progres backfill, dan
   peringatan bila angka antar widget tidak cocok.

LANGKAH 3 - TES (tampilkan hasilnya, build production, data nyata)
 - Detail perangkat untuk SEMUA 13 perangkat: tidak ada 500, tidak ada "tidak
   ditemukan" yang salah; semua rentang (24 Jam, 7 Hari, 30 Hari, 90 Hari, 1 Tahun,
   Kustom) dan skala Otomatis bekerja; perangkat tanpa riwayat menampilkan "Belum Ada
   Data".
 - Dashboard: angka sama dengan sumber (bandingkan dengan query langsung di database
   dan Event Log), semua invarian C lulus, heatmap menampilkan 13 perangkat, donut
   alarm = 17 insiden (atau sesuai data nyata), grafik tampil dengan angka benar.
 - Simulasi: tabel agregasi dikosongkan, kolom hilang, satu query timeout, Redis mati,
   data null/string tak terduga ke grafik, endpoint riwayat dipaksa gagal, backfill
   sedang berjalan. Hasil: tidak ada 500 tak terjelaskan, tidak ada "0" palsu, bagian
   lain tetap tampil, pesan spesifik dengan Coba Lagi, jumlah request berhenti sesuai
   batas retry (tunjukkan log request).
 - Setelah restart/deploy: migrasi berjalan, healthcheck benar, dashboard tidak kosong.
 - Kinerja: Dashboard data lengkap p95 < 500 ms, detail perangkat p95 < 600 ms;
   tabel sebelum vs sesudah (request, query, waktu).
 - Regresi: semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan
   390 px), peran/navigasi konsisten, respons endpoint lama identik, lint, typecheck,
   seluruh tes lama lulus. Tambahkan tes otomatis untuk invarian C dan untuk endpoint
   riwayat-status pada data kosong.

LAPORAN AKHIR (wajib)
 - Akar masalah (dengan bukti), apa yang diperbaiki/dimatikan, hasil backfill dan
   check:data, daftar file/migrasi yang diubah, lokasi backup, konfirmasi tertulis bahwa
   fitur lain tidak berubah, dan sisa risiko.