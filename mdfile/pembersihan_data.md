TUGAS: Bersihkan hasil pengujian dan data tidak terpakai dari proses pembuatan JagaLog
agar tidak menghabiskan disk dan memori. Hanya membersihkan. JANGAN mengubah fitur,
tampilan, skema yang masih dipakai, atau perilaku aplikasi.

ATURAN KERAS
- Default dry-run: tampilkan dulu apa yang akan dihapus beserta jumlah baris/ukuran.
  Hapus hanya setelah saya menjawab "setuju" untuk kategori tersebut.
- Buat backup sebelum menghapus apa pun di database (pg_dump terkompresi ke luar
  folder proyek, catat lokasinya).
- JANGAN menghapus: user admin dan user asli, perangkat asli (Main Mikrotik dan
  perangkat lain yang bukan data uji), pengaturan, channel notifikasi, aturan filter,
  insiden dan analisis AI yang berasal dari log asli, dan volume Docker Postgres/Redis
  yang sedang dipakai.
- JANGAN menjalankan "docker system prune -a --volumes", "docker volume prune", atau
  "DROP"/"TRUNCATE" tanpa persetujuan eksplisit dan daftar objek yang jelas.
- Semua penghapusan data besar dilakukan bertahap (batch 5.000 baris) agar tidak
  mengunci tabel, dengan indikator progres.
- Jika ragu apakah sesuatu data nyata atau data uji, JANGAN hapus; tandai sebagai
  "perlu keputusan" dan tanyakan.

LANGKAH 1 - UKUR DAN INVENTARIS (tanpa menghapus)
Laporkan dalam tabel: lokasi, ukuran, dan status (aman dihapus / perlu keputusan /
jangan disentuh).

A. Database PostgreSQL
- Ukuran database, 15 tabel/indeks terbesar (pg_total_relation_size), jumlah baris
  dan estimasi dead tuple (pg_stat_user_tables), tingkat bloat.
- Perangkat: daftar semua perangkat, tandai yang tampak data uji (nama/IP contoh,
  tidak pernah mengirim log asli, dibuat oleh seed demo).
- Log uji: pesan seperti "Tes log MikroTik via HTTP API", "tes JagaLog", hasil skrip
  uji kirim (1000 pesan palsu), event palsu dari skrip suntik serangan, log dari
  perangkat yang sudah dihapus atau tidak dikenal.
- Insiden, analisis AI, hasil ping, riwayat status, dan notifikasi yang terkait
  perangkat/log uji.
- Data seed demo (dari seed dashboard) dan data seed beban/performa (jutaan baris).
- Baris yatim (orphan): referensi ke perangkat yang tidak ada.
- Log yang lebih tua dari LOG_RETENTION_DAYS yang belum terhapus, partisi lama,
  ping_results lebih tua dari retensi, notification_log lama.
- Pesan banjir/berulang (misalnya "Download from ... FINISHED") yang menumpuk.
- Indeks yang tidak terpakai (pg_stat_user_indexes dengan idx_scan = 0).

B. Redis
- Ukuran memori (INFO memory), jumlah key per prefix, key tanpa TTL, job BullMQ
  selesai/gagal yang menumpuk, antrian macet, cache lama, sesi kedaluwarsa, penghitung
  uji.

C. Docker (mesin pengembangan dan server)
- Image dangling, image lama aplikasi, container berhenti, build cache, volume yang
  tidak dipakai container mana pun (tampilkan nama dan ukuran, JANGAN hapus
  volume berisi data Postgres/Redis), ukuran log container (/var/lib/docker/containers).
- Cek apakah rotasi log Docker (max-size, max-file) sudah dipasang di compose.

D. Folder proyek
- node_modules duplikat, .next, dist, build, .turbo, cache npm, folder coverage,
  hasil Playwright (test-results, playwright-report), screenshot uji, file dump
  sementara, backup lama, file .log, file seed besar, skrip uji yang tidak dipakai.
- Cek .gitignore sudah mencakup semuanya, dan tidak ada file besar atau rahasia
  (.env, dump database) yang ter-commit.

E. Disk server
- df -h, 10 folder terbesar, ukuran log sistem (journald), dan paket lama.

Berhenti di sini dan tunggu "lanjut" setelah saya membaca laporan.

LANGKAH 2 - RENCANA PEMBERSIHAN (dry-run)
Per kategori, tampilkan: apa yang dihapus, jumlah/ukuran, perkiraan ruang yang kembali,
risiko, dan perintah/SQL persis yang akan dijalankan. Tunggu "setuju" per kategori.

LANGKAH 3 - EKSEKUSI (hanya kategori yang saya setujui)

A. Database
1. Backup: pg_dump -Fc ke file di luar folder proyek, tampilkan ukuran dan lokasi.
   Verifikasi backup dapat dibaca (pg_restore --list).
2. Hapus dalam urutan yang menjaga relasi (anak dulu): hasil ping/riwayat/notifikasi/
   insiden/analisis AI yang terkait data uji, lalu log uji, lalu perangkat uji.
   Gunakan batch dan transaksi per batch. Tampilkan jumlah baris terhapus per tabel.
3. Penghapusan baris TIDAK mengembalikan ruang disk dengan sendirinya:
   - Tabel partisi: gunakan DROP PARTITION untuk partisi yang seluruhnya data
     uji/kedaluwarsa (ruang kembali langsung).
   - Tabel biasa: jalankan VACUUM (ANALYZE) dulu. Hanya bila bloat besar dan saya
     setuju, jalankan VACUUM FULL atau pg_repack pada tabel itu satu per satu di luar
     jam sibuk (peringatkan bahwa VACUUM FULL mengunci tabel dan butuh ruang kosong
     sebesar tabel).
4. Hapus indeks tidak terpakai hanya yang saya setujui, setelah memastikan tidak
   dipakai query penting.
5. Hitung ulang tabel ringkasan per jam untuk rentang yang terdampak.

B. Redis
- Hapus job BullMQ selesai/gagal lama (clean dengan batas umur/jumlah), cache lama,
  dan key uji berdasarkan prefix yang jelas (pakai SCAN, bukan KEYS; jangan FLUSHALL).
- Jangan menyentuh sesi aktif, antrian yang berisi job menunggu, dan job terjadwal
  (repeatable) yang sah.
- Pastikan semua key cache punya TTL dan maxmemory serta kebijakan eviction sudah
  diatur; tambahkan bila belum.

C. Docker
- Aman: docker image prune (dangling), docker builder prune, container berhenti yang
  saya setujui. Image lama aplikasi: hapus versi lama, simpan versi yang sedang jalan
  dan satu sebelumnya untuk rollback.
- Volume: hapus hanya volume yang saya konfirmasi namanya satu per satu.
- Pasang rotasi log Docker di docker-compose.yml (logging: driver json-file,
  max-size 10m, max-file 3) bila belum ada, tanpa mengubah hal lain di compose.
  Catat bahwa perubahan ini perlu redeploy.

D. Folder proyek
- Hapus artefak build/cache/hasil uji yang sudah disetujui. Perbarui .gitignore bila
  ada yang kurang. Jangan menghapus file sumber, migrasi, atau .env.example.
- Jika ada file besar atau rahasia ter-commit, laporkan (jangan tulis ulang riwayat
  Git tanpa persetujuan).

E. Pencegahan agar tidak menumpuk lagi
- Skrip "npm run clean:dev" untuk artefak lokal dan "npm run clean:test-data" untuk
  data uji; keduanya dry-run secara default dengan flag --apply.
- Pastikan data seed/uji diberi penanda (kolom atau prefix, misalnya is_demo atau
  nama diawali "[UJI]") sehingga mudah dibersihkan dan tidak tercampur data nyata.
  Tambahkan penanda ke seed yang ada tanpa mengubah perilaku aplikasi.
- Job retensi harian dipastikan benar-benar berjalan: tampilkan bukti (log eksekusi
  terakhir) dan partisi/retensi untuk log_events, ping_results, notification_log,
  dan log filter. Tambahkan retensi untuk tabel yang belum punya.
- Peringatan disk: indikator sederhana di /pengaturan (atau endpoint admin) yang
  menampilkan ukuran database, memori Redis, dan sisa disk, dengan peringatan
  teks bila sisa disk < 20%.
- Panduan README bagian "Pemeliharaan": perintah cek ukuran, cara membersihkan,
  dan frekuensi yang disarankan.

LANGKAH 4 - VERIFIKASI
- Ukur ulang semua metrik Langkah 1 dan tampilkan tabel sebelum vs sesudah (ukuran
  database, memori Redis, ruang Docker, ruang disk server).
- Pastikan aplikasi tetap sehat: login, daftar perangkat asli, Event Log perangkat
  asli, ringkasan, riwayat status, ping, dan notifikasi berjalan normal. Jalankan
  lint, typecheck, dan seluruh tes yang ada; tidak boleh ada yang gagal.
- Pastikan jumlah perangkat asli dan log asli (periode yang tidak dihapus) sama
  seperti sebelum pembersihan.
- Buat laporan akhir: apa yang dihapus, jumlah, ruang yang kembali, lokasi backup,
  dan hal yang sengaja tidak disentuh.