TUGAS: Dashboard (/) masih menampilkan "Gagal memuat data ringkasan dashboard. Permintaan
otomatis dihentikan sementara (30 detik) demi stabilitas sistem." Kartu menampilkan "-"
dan grafik menampilkan "Belum ada log pada 24 jam terakhir", padahal log terus masuk.
Loop kedipan sudah berhenti, tetapi pengambilan data MASIH gagal. Dugaan: ada limit
(timeout, memori, koneksi, rate limit, validasi) yang terlampaui. Temukan limit yang
menjadi penyebab berdasarkan BUKTI, perbaiki, dan pastikan kegagalan ditampilkan jujur.
Hanya perbaiki ini.

ATURAN KERAS (wajib dipatuhi)
- Jangan menebak. Setiap kesimpulan harus didukung bukti terukur (status HTTP, isi
  respons, log server, nilai konfigurasi, metrik). Ukur di build production dan di
  server yang sama dengan yang saya pakai.
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint
  yang tidak terkait. Respons endpoint lama tidak berubah (hanya aditif). Tema dan gaya
  tetap (terang, garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia).
- Keamanan tidak dilonggarkan: otorisasi server tetap fail-closed, tidak ada hak akses
  yang dinaikkan sebagai cadangan, tidak ada data sensitif di pesan error ke pengguna.
- Backup (pg_dump) sebelum mengubah data atau konfigurasi database. Migrasi aditif dan
  idempoten. Tidak menghapus data tanpa persetujuan saya. Tidak ada tabel/worker/job
  duplikat, tidak ada fetch ganda, tidak ada alert/confirm bawaan browser.
- Bila sebuah optimasi sebelumnya terbukti penyebab dan tidak bisa diperbaiki cepat,
  matikan lewat feature flag (env) dan laporkan. Kecepatan dan ketersediaan lebih
  penting daripada mempertahankan optimasi tertentu.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS BERBASIS BUKTI (jangan ubah kode atau konfigurasi dulu)
A. Reproduksi di production. Untuk SETIAP request dashboard yang gagal tampilkan:
   endpoint, metode, status HTTP, durasi, isi respons lengkap (pesan error), header
   Server-Timing, dan apakah kegagalan terjadi di server (5xx/4xx/timeout) atau di
   klien (respons 200 tetapi ditolak validasi Zod, parse JSON gagal, atau pengecekan
   bentuk data). Jika kegagalan di klien: tampilkan respons mentah dan field yang
   ditolak.
B. Inventaris SEMUA limit dan batas yang ada, dengan nilai SEKARANG dan file:baris/lokasi
   konfigurasinya, lalu tandai mana yang terlampaui saat dashboard dimuat:
   1. Postgres: statement_timeout, lock_timeout, idle_in_transaction_session_timeout,
      max_connections, jumlah koneksi aktif/idle/idle-in-transaction (pg_stat_activity),
      query yang sedang berjalan lama atau menunggu kunci (pg_locks), ukuran pool tiap
      service (app, worker, collector), dan error "too many clients"/"timeout" di log.
   2. Redis: maxmemory, maxmemory-policy, used_memory, jumlah key per prefix, key tanpa
      TTL, rejected_connections, latensi, batas klien, ukuran antrian BullMQ (jumlah
      job waiting/active/failed/completed), dan error "OOM command not allowed" di log.
      Periksa apakah kegagalan menulis cache ikut menggagalkan seluruh request.
   3. Timeout dan batas di kode: timeout Redis, batas tunggu kunci cache, pelindung
      stampede, circuit breaker klien (3 kegagalan -> 30 detik), batas retry, route
      segment config Next.js (maxDuration, dynamic, runtime), batas ukuran body.
   4. Rate limit aplikasi: limiter per pengguna/IP/endpoint (termasuk limiter login,
      client-error, API umum) dan apakah endpoint dashboard terkena 429.
   5. Proxy/infrastruktur: timeout Traefik/Coolify, batas memori/CPU tiap container,
      OOMKilled dan RestartCount tiap container, penggunaan CPU/memori saat dashboard
      dimuat, ruang disk server dan volume (df -h), dan inode.
   6. Validasi klien: skema Zod untuk respons dashboard vs bentuk respons sebenarnya
      (field null, angka sebagai string, field baru/lama, array kosong, BigInt/Decimal
      dari Postgres yang diserialisasi sebagai string).
   7. Sesi/peran: apakah endpoint dashboard mengembalikan 401/403 untuk akun ini.
C. Telusuri alur satu request dashboard dari awal sampai akhir dengan stempel waktu di
   tiap tahap (auth -> cache -> query -> serialisasi -> respons -> validasi klien) dan
   tunjukkan DI TAHAP MANA gagal dan KARENA LIMIT APA. Jalankan tiap query dashboard
   secara terpisah dengan EXPLAIN (ANALYZE, BUFFERS) dan catat durasinya terhadap
   statement_timeout.
D. Cek mengapa endpoint tidak mengembalikan data parsial: apakah satu sub-query yang
   gagal menggagalkan seluruh endpoint.
E. Bandingkan dengan keadaan sebelum optimasi (commit sebelumnya) untuk menunjukkan apa
   yang berubah.
Laporkan: limit penyebab (urut kontribusi) dengan bukti, dan limit lain yang berisiko.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN (sesuai bukti Langkah 1; prinsip wajib)

A. Atur limit berdasarkan pengukuran, bukan tebakan
 - Setiap timeout dan batas diset dari data terukur (p99 + margin), bukan angka tebakan.
   Contoh: statement_timeout dashboard = max(5 detik, 3 x p99 terukur) khusus untuk
   sesi/query dashboard, bukan global.
 - Redis penuh/noeviction: pisahkan penggunaan. Cache memakai database/instance atau
   prefix terpisah dengan kebijakan allkeys-lru dan batas memori sendiri, semua key
   cache wajib TTL. Antrian BullMQ tetap aman dari eviction. Bersihkan job
   selesai/gagal (removeOnComplete/removeOnFail dengan batas jumlah dan umur) dan key
   tanpa TTL. Kegagalan menulis ke cache TIDAK BOLEH menggagalkan request (tangkap,
   catat, lanjut tanpa cache).
 - Pool koneksi: total semua service di bawah max_connections dengan sisa untuk admin;
   perbaiki kebocoran koneksi dan transaksi menggantung; antrean menunggu koneksi diberi
   batas waktu dan pesan jelas.
 - Rate limit: endpoint baca dashboard dan SSE tidak boleh terkena limiter yang
   dirancang untuk login atau ingest. Batas per pengguna yang wajar dan terdokumentasi;
   respons 429 menyertakan Retry-After dan klien menghormatinya.
 - Memori/CPU container dan disk: bila OOMKilled atau disk hampir penuh, laporkan dan
   usulkan nilai batas yang cukup (jangan menghapus data tanpa persetujuan saya).
 - Timeout proxy disesuaikan agar lebih besar dari timeout aplikasi.
 - Validasi klien: skema respons dibuat toleran (field opsional/nullable, angka dari
   string dikonversi, default aman). Respons yang sebagian tidak valid: tampilkan bagian
   yang valid dan tandai bagian yang gagal, jangan menolak seluruh respons.

B. Dashboard per bagian, bukan semua-atau-tidak-sama-sekali
 - Endpoint ringkasan memakai hasil parsial: tiap bagian (perangkat, insiden, volume log,
   status AI, grafik) dihitung dan dikembalikan terpisah. Satu bagian gagal tidak
   membatalkan yang lain. Respons memuat status per bagian (ok | gagal | basi) dan
   alasan singkat yang aman.
 - Fallback bertingkat per bagian: cache segar -> cache basi (tandai "Data mungkin tidak
   terbaru, diperbarui 4 menit lalu") -> hitung ringan dari tabel agregasi -> pesan
   error lokal dengan "Coba Lagi".
 - Bagian yang gagal TIDAK boleh tampil sebagai nilai kosong yang menyesatkan:
     * Kartu angka: tampilkan "-" konsisten (bukan "0 log" pada satu kartu dan "-" pada
       kartu lain).
     * Grafik: bila error tampilkan "Gagal memuat grafik. Coba lagi." dengan tombol;
       "Belum ada log pada 24 jam terakhir" HANYA bila pengecekan sukses dan hasilnya
       benar-benar nol.
     * Banner error global diganti pesan per bagian; banner global hanya muncul bila
       SEMUA bagian gagal.
 - Pesan error informatif tetapi aman, dibedakan: "Server terlalu sibuk" (timeout),
   "Terlalu banyak permintaan, coba lagi dalam N detik" (429), "Sesi berakhir" (401),
   "Tidak punya izin" (403), "Layanan cache/antrian bermasalah" (Redis), "Data tidak
   dapat dibaca" (validasi). Sertakan kode referensi singkat yang cocok dengan log
   server. Tanpa stack trace atau data sensitif.
 - Circuit breaker klien dipertahankan, tetapi pesannya menyebut alasan dan hitung
   mundur, dan tombol "Coba Lagi" selalu bisa memicu satu percobaan manual.

C. Diagnostik untuk admin (agar tidak perlu menebak lagi)
 - Endpoint GET /api/admin/diagnostik (hanya admin, tanpa rahasia): status dan latensi
   Postgres dan Redis, jumlah koneksi vs batas, memori Redis vs maxmemory dan kebijakan,
   panjang antrian BullMQ, ruang disk (bila dapat dibaca aplikasi), versi build, nilai
   limit penting yang aktif, dan hasil uji ringan tiap bagian dashboard (durasi dan
   status). Hasil di-cache 10 detik dan dibatasi lajunya.
 - Tampilan ringkas di /pengaturan (bagian "Kesehatan sistem") dengan status teks +
   glyph (OK / Perlu perhatian / Gagal) dan penjelasan singkat Bahasa Indonesia. Gaya
   komponen yang sudah ada. Peringatan proaktif bila Redis > 80% memori, koneksi DB
   > 80% batas, disk < 20%, atau antrian menumpuk.

D. Sakelar pengaman (kill switch)
 - Env DASHBOARD_FAST_PATH (true/false): false mengembalikan jalur pemuatan dashboard
   versi sebelum optimasi (tanpa pelindung stampede/warm-up/agregasi baru) agar bisa
   dipulihkan cepat tanpa deploy ulang kode. Dokumentasikan di README.

E. Pencegahan
 - Tes otomatis: respons dashboard dengan satu bagian gagal tetap menampilkan bagian
   lain; Redis penuh tidak menggagalkan request; timeout memberi fallback; 429 dihormati.
 - Peringatan log untuk limit yang mendekati batas dan untuk endpoint yang gagal berulang.

LANGKAH 3 - TES (tampilkan hasilnya, build production)
 - Dashboard menampilkan data nyata pada kondisi normal: angka perangkat, insiden, volume
   log 24 jam, dan grafik sama dengan sumber (tabel agregasi dan Event Log).
 - Simulasi tiap limit: Redis penuh (noeviction), Redis mati, Redis lambat 2 detik,
   statement_timeout terlampaui pada satu query, pool koneksi habis, 429, respons dengan
   field null/tipe tidak terduga (validasi), container app direstart, disk hampir penuh
   (simulasi), dan satu bagian dashboard diatur gagal. Hasil yang diharapkan: bagian lain
   tetap tampil, bagian gagal menampilkan pesan spesifik + Coba Lagi, tidak ada kedipan,
   tidak ada loop, tidak ada "0"/"Belum ada log" palsu, jumlah request berhenti sesuai
   batas retry.
 - Pemulihan: setelah penyebab dihilangkan, dashboard pulih otomatis atau lewat Coba
   Lagi dalam batas wajar.
 - Panel diagnostik: nilai sesuai kenyataan (bandingkan dengan perintah manual di server),
   hanya admin yang dapat membuka, dan tidak membocorkan rahasia.
 - Kill switch: DASHBOARD_FAST_PATH=false memulihkan perilaku lama dan data tampil.
 - Kinerja: tabel sebelum vs sesudah (waktu kerangka, waktu data lengkap, jumlah request
   dan query) dan target p95 Dashboard data lengkap < 500 ms pada kondisi normal.
 - Regresi: semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan 390 px),
   peran dan navigasi tetap konsisten, respons endpoint lama identik, lint, typecheck,
   dan seluruh tes lama lulus.

LAPORAN AKHIR (wajib)
 - Limit yang menjadi penyebab (dengan bukti dan nilainya sebelum/sesudah), limit lain
   yang berisiko, apa yang diubah atau dimatikan, daftar file/migrasi/konfigurasi, lokasi
   backup, konfirmasi tertulis bahwa fitur lain tidak berubah, dan sisa risiko.
   