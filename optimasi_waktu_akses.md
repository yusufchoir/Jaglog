TUGAS (dua bagian, kerjakan berurutan; berhenti di akhir Langkah 1 dan Langkah 2):
BAGIAN A - Grafik "Aktivitas Volume Log per Jam (24 Jam Terakhir)": tambahkan angka,
           sumbu, ringkasan, dan penjelasan agar grafik bisa dipahami.
BAGIAN B - Percepat pemuatan Dashboard dan Event Log yang saat ini menunggu beberapa
           detik sebelum data tampil.

ATURAN KERAS (wajib dipatuhi)
- Hanya mengerjakan dua bagian di atas. Jangan mengubah fitur, perhitungan, aturan
  deteksi, parser, endpoint lama (bentuk respons tidak berubah; penambahan harus
  aditif), tema, atau perilaku yang sudah benar. Tema tetap: terang, aksen biru #1F5FBF
  dan merah #C8372D hanya sebagai garis hiasan tipis, tanpa gradient/glow/emoji, font
  Plus Jakarta Sans dan JetBrains Mono, teks Bahasa Indonesia yang spesifik.
- Pakai ulang library grafik, komponen, hook, cache, SSE, dan tabel agregasi yang sudah
  ada. Jika proses penyatuan data grup/ringkasan armada sedang atau sudah dikerjakan,
  pakai sumber yang sama dan jangan membuat salinan. Tidak ada tabel, worker, atau job
  duplikat. Tidak ada fetch ganda dan tidak ada pengiriman data ganda.
- Angka grafik dan angka tabel harus berasal dari satu sumber data yang sama dan harus
  sama persis dengan hitungan log yang diterima. Jangan memalsukan data. Bila data
  tidak ada tampilkan "-".
- Semua perubahan data harus aman: backup (pg_dump) sebelum migrasi, migrasi aditif dan
  idempoten, tidak menghapus data tanpa persetujuan saya.
- Tidak ada alert/confirm bawaan browser. Jika ragu, jangan ubah dan tanyakan.

========================================
LANGKAH 1 - INVENTARIS DAN PENGUKURAN (jangan ubah kode atau data)
========================================
A. Grafik
- File komponen grafik, library yang dipakai, endpoint dan query sumber datanya, cara
  jam dikelompokkan (zona waktu Asia/Jakarta atau UTC), cara jam yang sedang berjalan
  dan jam pertama pada rentang 24 jam ditangani (apakah parsial), dan apakah angka
  mencakup pesan yang digabung/dibuang oleh filter (harus mencakup pesan DITERIMA).
- Mengapa batang paling kiri sangat pendek dan batang paling kanan lebih rendah:
  tunjukkan buktinya (jam parsial atau data nyata).

B. Kecepatan (ukur di build production, bukan mode dev)
- Untuk /, Event Log di detail perangkat (default tanpa filter, dengan rentang 24 jam,
  dan dengan pencarian teks), tab Ringkasan perangkat: waktu sampai kerangka halaman
  tampil, waktu sampai data lengkap tampil (LCP/TTFB), jumlah dan urutan request
  (waterfall), ukuran tiap respons (KB), jumlah query SQL, waktu tiap query, dan ukuran
  bundle JS yang dimuat.
- Aktifkan pg_stat_statements: 10 query teratas berdasarkan total_exec_time dan calls.
- EXPLAIN (ANALYZE, BUFFERS) untuk semua query di halaman itu: tandai Seq Scan pada
  log_events, COUNT(*) pada tabel besar, sort tanpa indeks, OFFSET besar, dan pemakaian
  pencarian teks (pg_trgm) tanpa batas waktu.
- Ukuran tabel log_events (baris, GB), jumlah partisi (bila ada), indeks yang ada dan
  yang terpakai (pg_stat_user_indexes), dead tuple/bloat.
- Server component vs klien: apakah data diambil berantai (menunggu satu selesai baru
  mulai yang lain), diambil dua kali, atau ada render yang memblokir (tidak memakai
  Suspense/streaming).
- Cache: apakah ada cache Redis untuk data dashboard, TTL-nya, dan hit rate.
- Konfigurasi database dan pool koneksi (shared_buffers, work_mem, max_connections,
  ukuran pool tiap service) serta batas CPU/memori container.
- Laporkan akar penyebab lambat berurutan dari yang paling besar kontribusinya
  (dalam ms), dengan file:baris. Berhenti dan tunggu "lanjut".

========================================
LANGKAH 2 - IMPLEMENTASI
========================================

--- BAGIAN A: GRAFIK YANG BISA DIBACA ---

A1. Sumber data (aditif)
- Endpoint grafik mengembalikan, selain nilai yang sudah ada (field lama tidak
  berubah), field baru per jam: mulai, selesai, jumlah_log, jumlah_per_severity
  (critical, error, warning, notice, info, debug), jumlah_perangkat_aktif, parsial
  (bool), dan top_perangkat (3 perangkat teratas beserta jumlah). Plus ringkasan:
  total_24j, rata_rata_per_jam (dihitung dari jam penuh saja), puncak { jam, jumlah },
  terendah_jam_penuh { jam, jumlah }, total_periode_sebelumnya (24 jam sebelumnya) dan
  persen_perubahan.
- Ambil dari tabel agregasi per jam yang sudah ada (log_stats_hourly atau setara),
  bukan memindai log_events. Jika belum ada kolom per severity atau top perangkat,
  tambahkan di agregasi yang sudah ada lewat migrasi aditif dengan backfill dari data
  mentah yang masih tersimpan. Jam berjalan dihitung dari agregasi inkremental atau
  cache pendek (TTL 15-30 detik), bukan scan penuh.
- Zona waktu Asia/Jakarta konsisten; batas jam 00 menit WIB.

A2. Tampilan
1. Sumbu Y dengan angka berformat Indonesia dan ringkas (mis. 0, 5 rb, 10 rb, 15 rb;
   atau 5.000, 10.000, 15.000), garis bantu berlabel, dimulai dari 0. Label sumbu Y:
   "Jumlah log per jam".
2. Sumbu X dengan label jam WIB tiap 3 jam ("00.00", "03.00", ... ) dan tanggal pada
   pergantian hari (mis. "13 Nov"); di layar sempit label tiap 6 jam. Label sumbu X:
   "Jam (WIB)".
3. Label angka di atas batang puncak dan batang tertinggi saat hover; angka pada semua
   batang tidak ditampilkan bila padat (hindari tumpang tindih).
4. Garis rata-rata putus-putus tipis (warna biru tema) berlabel "Rata-rata 12.480 log/jam".
5. Batang puncak diberi penanda halus dan label "Puncak". Aksen merah tipis hanya
   untuk jam yang jauh di atas rata-rata (mis. > 2x) dan diberi tanda "Lonjakan".
6. Jam parsial (jam pertama bila belum penuh dan jam berjalan) digambar dengan
   pola garis miring atau garis putus-putus dan tooltip "Jam belum penuh (baru 23
   menit)"; TIDAK dihitung dalam rata-rata dan tidak dianggap penurunan.
7. Kartu ringkasan di atas grafik (4 angka kecil dengan keterangan):
   - Total 24 jam: "299.540 log" + perubahan terhadap 24 jam sebelumnya
     ("naik 4,2% dari kemarin"; "-" bila tidak ada pembanding)
   - Rata-rata per jam: "12.480 log"
   - Puncak: "14.193 log, 01.00-02.00 WIB"
   - Terendah (jam penuh): "9.120 log, 21.00-22.00 WIB"
8. Tooltip (hover desktop, tap mobile; juga muncul saat fokus keyboard) dalam format
   Indonesia, contoh:
   "Jumat, 13 Nov 2026, 01.00-02.00 WIB
    14.193 log (4 log/detik)
    Critical 0 - Error 12 - Warning 340 - Info 13.800
    1,4x rata-rata - 4,7% dari total 24 jam
    Terbanyak: Main Mikrotik (9.800)"
   Tanggal tidak lagi memakai format 2026-11-13 01:00.
9. Pilihan tampilan (segmen kecil di kepala kartu): "Semua" (default, satu warna biru
   tema) dan "Per tingkat keparahan" (batang bertumpuk dengan warna severity yang
   sudah ada di legenda: Critical merah, High oranye tua, Medium kuning tua, Low biru,
   Info abu). Legenda ditampilkan hanya pada mode ini. Warna tidak menjadi satu-satunya
   pembeda: tooltip menyebut nama severity dengan teks.
10. Blok "Cara membaca grafik" (ringkas, bisa dilipat, tersimpan sebagai preferensi
    tampilan pengguna): 2-3 kalimat Bahasa Indonesia, mis. "Setiap batang adalah
    jumlah log yang diterima JagaLog dari semua perangkat dalam satu jam. Batang yang
    jauh lebih tinggi dari rata-rata bisa berarti ada aktivitas tidak biasa atau
    perangkat yang membanjir log. Batang yang sangat rendah atau kosong bisa berarti
    perangkat berhenti mengirim log."
11. Penjelasan otomatis satu kalimat di bawah grafik (aturan, bukan AI): mis.
    "Volume stabil, tertinggi pukul 01.00 (14.193 log)." / "Ada lonjakan 3,1x pada
    pukul 14.00 dari Main Mikrotik. Periksa Event Log." / "Tidak ada log pada
    pukul 03.00-05.00." Kalimat dihasilkan dari ringkasan data dengan ambang yang
    terpusat; tanpa klaim keamanan yang tidak bisa dibuktikan.
12. Klik batang: buka Event Log pada rentang jam itu (tautan dengan filter waktu yang
    sudah ada); tombol "Lihat log jam ini" di tooltip pada layar sentuh. Pada halaman
    detail perangkat grafik yang sama menampilkan data perangkat itu saja.
13. Jam tanpa data ditampilkan sebagai batang kosong dengan garis dasar tipis dan
    tooltip "Tidak ada log". Seluruh rentang tanpa data: pesan "Belum ada log pada 24
    jam terakhir" dengan tautan ke "Cara mengirim log".
14. Aksesibilitas: grafik punya ringkasan teks (aria-label) dan alternatif tabel
    ("Lihat sebagai tabel") berisi jam, jumlah, per severity; navigasi keyboard antar
    batang; kontras WCAG AA; hormati prefers-reduced-motion.
15. Mobile/PWA: sumbu dan label menyesuaikan (label X tiap 6 jam, angka Y ringkas),
    tooltip lewat tap, kartu ringkasan 2x2. Desktop >= 1024 px: tata letak lain
    tidak berubah.
16. Pembaruan langsung: jam berjalan diperbarui lewat SSE yang sudah ada (hanya batang
    terakhir dan kartu ringkasan, tanpa memuat ulang seluruh grafik).

--- BAGIAN B: PERCEPAT DASHBOARD DAN EVENT LOG ---
Target (p95, build production, seed 5 juta baris log dan 20 perangkat): kerangka halaman
< 200 ms, Dashboard data lengkap < 500 ms, Event Log 24 jam < 600 ms, dengan pencarian
teks + filter waktu < 800 ms. Terapkan sesuai temuan Langkah 1:

B1. Jangan menghitung dari log mentah untuk tampilan ringkasan
- Semua angka ringkasan (kartu, grafik, top IP, top akun, distribusi severity,
  jumlah per perangkat) dibaca dari tabel agregasi per jam/menit yang diisi inkremental
  oleh worker yang sudah ada saat ingest. Jam berjalan: agregasi inkremental atau cache
  pendek. Hapus semua COUNT(*) dan GROUP BY langsung pada log_events untuk halaman
  ini. Total di Event Log memakai estimasi/hitungan terbatas ("Menampilkan 100 dari
  sekitar 14.000"), bukan COUNT(*) penuh.

B2. Query dan indeks
- Event Log: pagination cursor (event_time, id) dengan indeks
  (device_id, event_time DESC, id DESC); jangan OFFSET. Filter yang umum (severity,
  kategori) memakai indeks gabungan yang sesuai urutan filter, berdasarkan EXPLAIN.
- Pencarian teks wajib dengan batas waktu (default 24 jam); pg_trgm hanya efektif pada
  rentang terbatas. Debounce 400 ms. Peringatan singkat bila rentang sangat lebar.
- Bila log_events belum dipartisi dan ukurannya besar, partisi per hari/minggu
  (DROP PARTITION untuk retensi) dilakukan SEBAGAI TAHAP TERPISAH dengan rencana
  migrasi dan persetujuan saya; jangan dikerjakan diam-diam. Jika tidak disetujui,
  gunakan indeks dan batas waktu saja.
- Hapus indeks yang tidak terpakai, jalankan VACUUM ANALYZE pada tabel terdampak, dan
  gabungkan query bertahap menjadi satu query (join/CTE) bila memungkinkan. Tidak ada
  N+1; satu query GROUP BY untuk data per perangkat/grup.

B3. Alur pemuatan halaman
- Tidak ada waterfall: semua data halaman diminta paralel (Promise.all di server atau
  prefetch bersamaan), atau satu endpoint ringkasan per halaman. Data yang sama tidak
  diambil dua kali (server component dan klien berbagi cache; dedupe permintaan).
- Streaming/Suspense: kerangka halaman, navigasi, dan skeleton tampil seketika; tiap
  widget memuat datanya sendiri dan muncul begitu siap (widget cepat tidak menunggu
  widget lambat). Skeleton berukuran sama dengan konten agar tidak melompat.
- stale-while-revalidate: tampilkan data terakhir dari cache segera, lalu perbarui
  diam-diam di latar belakang dan lewat SSE; tidak ada kedipan kosong saat berpindah
  halaman atau berganti tab. Gunakan keepPreviousData saat filter berubah.
- Prefetch halaman yang kemungkinan dibuka (hover/fokus tautan perangkat dan tab Event
  Log) dengan batas agar tidak boros.
- Event Log: render 50-100 baris pertama dulu, virtualisasi daftar, muat berikutnya
  saat scroll; kolom raw/parsed hanya dimuat saat baris dibuka (endpoint detail
  tersendiri), bukan di daftar.

B4. Cache dan payload
- Cache Redis untuk respons ringkasan dengan TTL 15-30 detik per kombinasi
  (pengguna-peran, perangkat, rentang), di-invalidasi oleh event perubahan yang sudah
  ada; slot yang sudah lewat TTL lebih panjang. Lindungi dari stampede (satu
  pembangun cache, yang lain menunggu).
- Kecilkan payload: hanya field yang dipakai UI, tanpa raw log di daftar, kompresi
  respons (gzip/brotli) diaktifkan, ETag/If-None-Match untuk respons yang jarang
  berubah. Header Cache-Control tidak boleh membuat data pengguna tersimpan di cache
  bersama.

B5. Bundle dan klien
- Kode grafik, peta, dan halaman jarang dipakai dimuat dinamis (dynamic import) hanya
  di halaman yang memakainya. Target bundle halaman utama < 200 KB gzip (JS). Font
  dengan font-display swap dan subset. Hindari render ulang berat (memo, tanpa
  mount ulang grafik saat data berubah).

B6. Basis data dan infrastruktur
- Periksa ukuran pool koneksi (total tidak melebihi max_connections), pakai koneksi
  berumur panjang (tidak membuka koneksi tiap request), statement timeout wajar
  (mis. 5 detik) agar query liar tidak menggantung, dan parameter dasar Postgres
  sesuai RAM (shared_buffers, effective_cache_size, work_mem). Terapkan hanya yang
  dibuktikan bermanfaat dan jelaskan dampaknya.
- Tambahkan header Server-Timing pada endpoint utama (waktu DB, cache, total) untuk
  memudahkan pengukuran. Hanya admin yang melihat rincian di UI/diagnostik; tidak ada
  data sensitif di header.
- Warm-up: setelah deploy/restart, panaskan cache ringkasan dan koneksi DB agar
  pengguna pertama tidak menunggu lama.

B7. Pencegahan regresi
- Tes otomatis anggaran performa: jumlah request, jumlah query, dan batas waktu per
  halaman gagal bila terlampaui. Tambahkan `npm run bench:ui` yang mengukur p95 dengan
  data seed.

========================================
LANGKAH 3 - TES (tampilkan hasilnya)
========================================
Grafik:
- Angka grafik sama dengan hitungan di tabel agregasi dan dengan jumlah log di Event Log
  untuk rentang jam yang sama (uji beberapa jam acak).
- Sumbu Y/X, garis rata-rata, penanda puncak/lonjakan, jam parsial bergaris dan tidak
  dihitung dalam rata-rata, kartu ringkasan, tooltip format Indonesia, mode per severity,
  klik batang membuka Event Log pada jam itu, penjelasan otomatis untuk skenario: stabil,
  lonjakan, jam kosong, tanpa data.
- Zona waktu: batas jam WIB benar, pergantian hari benar, tidak ada pergeseran 7 jam.
- SSE: batang jam berjalan dan kartu ringkasan bertambah tanpa memuat ulang grafik.
- Mobile 360/390/768, tablet, PWA, keyboard, pembaca layar, tabel alternatif, kontras
  AA, reduced motion. Tampilkan screenshot sebelum dan sesudah.
Kecepatan (tabel SEBELUM vs SESUDAH pada build production):
- Dashboard dan Event Log: waktu kerangka tampil, waktu data lengkap, jumlah request,
  jumlah query, ukuran respons, ukuran bundle; p50/p95 dengan seed 5 juta baris,
  20 perangkat, dan 300 perangkat.
- EXPLAIN ANALYZE sesudah perbaikan: tidak ada Seq Scan pada log_events untuk query
  halaman, tidak ada COUNT(*) penuh, tidak ada OFFSET besar.
- Cache dingin vs hangat, setelah restart (warm-up), dan lonjakan 3000 log/detik:
  waktu respons tetap dalam target dan ingest tidak melambat.
- Tab tersembunyi/kembali tampil: tampilan segera dari cache lalu diperbarui.
- Regresi: semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan 390 px),
  respons endpoint lama identik, lint, typecheck, seluruh tes lama lulus. Tambahkan tes
  regresi otomatis untuk angka grafik dan anggaran performa.

LAPORAN AKHIR (wajib)
- Akar masalah lambat (urut kontribusi), perubahan yang dibuat dan hasil sebelum vs
  sesudah, daftar file/migrasi yang diubah/ditambah, lokasi backup, konfirmasi tertulis
  bahwa fitur lain tidak berubah, dan hal yang butuh persetujuan saya (mis. partisi
  tabel log).