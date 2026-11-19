TUGAS: Pada kartu "Ketersediaan & Riwayat Status" (tab Ringkasan detail perangkat),
TAMBAHKAN dua baris kotak-kotak baru di bawah bar yang sudah ada:
  1. "Ping Server"     -> hasil ping: Up atau Down
  2. "Pengiriman Log" -> perangkat mengirim log atau tidak

ATURAN KERAS (wajib dipatuhi)
- Hanya menambah dua baris itu. JANGAN mengubah bar status yang sudah ada, perhitungan
  uptime (24 Jam, 7 Hari, Kustom), Total Gangguan, Gangguan Terlama, kontrol Rentang
  dan Skala, tema, warna, font, atau komponen lain.
- Pakai ulang rentang, skala, fungsi pembentuk slot, dan zona waktu (Asia/Jakarta) yang
  sudah ada. Slot kedua baris baru harus PERSIS sama dengan slot bar yang ada (jumlah,
  batas waktu, urutan, lebar), sehingga kotak-kotak sejajar secara vertikal.
- Tidak boleh ada endpoint baru atau fetch tambahan di UI. Perluas respons endpoint
  riwayat-status yang sudah ada dengan field baru (aditif; field lama tidak berubah
  nama, tipe, atau nilainya).
- Tidak boleh ada tabel, worker, atau job duplikat. Pakai yang sudah ada. Tambah
  struktur baru hanya jika hasil inventaris membuktikan data yang dibutuhkan tidak ada,
  dan lapor dulu di Langkah 1.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan dengan file:baris:
a. Komponen kartu, endpoint, fungsi pembentuk slot, dan cara kontrol Rentang/Skala
   bekerja saat ini.
b. Sumber data ping: tabel ping_results (atau yang setara), retensinya, apakah ada
   agregasi per jam, dan apakah perangkat dengan ping_enabled=false menyimpan hasil.
c. Sumber data pengiriman log: apakah ada hitungan log per perangkat per jam
   (log_stats_hourly atau setara), retensinya, dan apakah hitungan itu mencakup pesan
   yang digabung/dibuang oleh filter log atau rate limit (pesan yang diterima tetapi
   tidak disimpan).
d. Apakah ada catatan kapan ping diaktifkan/dinonaktifkan dan kapan perangkat
   diaktifkan/dinonaktifkan (untuk membedakan "tidak ada data" dari "gagal").
e. Apakah data tersedia untuk SEMUA rentang (24 Jam sampai 1 Tahun) atau hanya sebagian
   karena retensi (contoh: ping_results hanya 14 hari, log_events hanya 30 hari).
f. Rencana perubahan minimal: daftar file yang akan diubah, dan struktur baru (jika
   benar-benar perlu) beserta alasannya.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Data sumber (hanya jika Langkah 1 menunjukkan kurang)
- Ping: agregasi per jam per perangkat (jumlah cek, jumlah sukses, jumlah gagal,
  RTO terpanjang berturut-turut). Diisi worker ping yang SUDAH ADA (bukan worker baru),
  dengan backfill dari data mentah yang masih ada. Retensi agregasi minimal 400 hari.
- Log: hitungan per jam per perangkat dari tabel ringkasan yang sudah ada. Hitungan
  harus memuat semua pesan yang DITERIMA, termasuk yang digabung atau dibuang oleh
  filter/rate limit. Jika belum begitu, tambahkan penghitung "diterima" tanpa mengubah
  perilaku filter. Retensi minimal 400 hari.
- Dua baris baru tidak boleh memindai log_events atau ping_results mentah untuk
  rentang panjang. Baca dari agregasi per jam.

B. Aturan status slot (satu fungsi terpusat, konstanta ambang di satu tempat)
Baris "Ping Server":
- Belum Ada Data (abu-abu): slot sebelum perangkat dibuat, saat ping tidak aktif,
  saat perangkat nonaktif, atau tidak ada satu pun hasil cek di slot itu.
- Up (hijau): semua cek di slot sukses.
- Sebagian (kuning): ada cek gagal, tetapi waktu gagal kurang dari ambang Down.
- Down (merah): proporsi cek gagal >= ambang Down. Ambang: skala <= 1 jam: ada
  gagal berturut-turut >= ambang RTO perangkat (ping_fail_threshold); skala 4-6 jam:
  >= 10% cek gagal; skala >= 1 hari: >= 5% cek gagal.
Baris "Pengiriman Log":
- Belum Ada Data (abu-abu): slot sebelum perangkat dibuat, atau saat perangkat
  nonaktif. Perangkat nonaktif TIDAK dihitung "tidak mengirim".
- Mengirim (hijau): slot punya log dan tidak ada celah diam melebihi ambang.
- Sebagian (kuning): ada log, tetapi ada celah tanpa log yang melebihi ambang celah
  (misalnya >= offline_after_minutes perangkat) di dalam slot. Hitung celah dari
  hitungan per jam (jam tanpa log) untuk slot >= 1 jam, dan dari data riwayat status
  "log_stopped" jika tersedia.
- Tidak Mengirim (merah): tidak ada log sama sekali di slot, padahal perangkat aktif
  dan sudah pernah mengirim sebelumnya.
- Slot pertama dan terakhir yang belum penuh ditandai "sebagian slot" di tooltip.
  Slot yang sedang berjalan tidak boleh langsung merah hanya karena belum ada log di
  menit-menit awal; evaluasi hanya porsi yang sudah lewat.
Gunakan warna yang SUDAH ADA di legenda (hijau, kuning, merah, abu-abu). Jangan
menambah warna baru.

C. Respons endpoint (aditif)
Tambahkan ke respons yang sudah ada, tanpa mengubah field lama:
  ping:  { aktif: bool, slot: [{ mulai, selesai, status, cek_total, cek_gagal,
           persen_sukses, rtt_rata_ms, gagal_terpanjang_detik }],
           ringkasan: { persen_up, jumlah_down, down_terlama_detik } }
  pengiriman_log: { slot: [{ mulai, selesai, status, jumlah_log,
           celah_terpanjang_detik }],
           ringkasan: { persen_mengirim, jumlah_periode_tidak_mengirim,
           tidak_mengirim_terlama_detik, log_terakhir_pada } }
Cache Redis memakai kunci dan TTL yang sama dengan data lama (atau turunannya).
Validasi Zod untuk field baru. Satu request per perubahan pilihan seperti sekarang.

D. UI
- Tambahkan dua baris di bawah bar lama, masing-masing dengan label di kiri
  ("Ping Server", "Pengiriman Log"), tinggi lebih kecil dari bar utama, memakai gaya
  kotak, jarak, dan warna yang sama.
- Sumbu waktu (label kiri/kanan) tetap satu, milik bar lama; tidak diduplikasi.
- Legenda: tambahkan legenda kecil per baris dengan istilah spesifik baris itu
  (Ping: Up, Sebagian, Down, Belum Ada Data. Log: Mengirim, Sebagian, Tidak Mengirim,
  Belum Ada Data). Legenda bar lama tidak diubah.
- Ringkasan singkat di ujung kanan tiap baris, contoh: "Up 99,2%" dan
  "Log terakhir 3 menit lalu". Jangan menyentuh kartu ringkasan di kepala.
- Tooltip (juga muncul saat fokus keyboard), contoh:
  Ping:  "Kam, 5 Nov 08.00-08.30 WIB - Down - 7 dari 30 cek gagal (RTO terpanjang
          3 menit)"
  Log:   "Kam, 5 Nov 08.00-08.30 WIB - Tidak mengirim - 0 log diterima"
- Klik kotak: buka panel kecil di bawah baris itu. Ping: daftar kejadian Down
  (mulai, selesai, durasi). Log: daftar periode tidak mengirim, dengan tautan ke tab
  Event Log pada rentang waktu yang sama.
- Bila ping_enabled=false: baris Ping Server tampil sebagai satu bar abu-abu dengan
  teks "Ping belum diaktifkan untuk perangkat ini" dan tautan ke Konfigurasi
  Perangkat. Jangan tampilkan angka 100%.
- Bila data tidak mencakup seluruh rentang karena retensi: kotak yang tidak punya
  data tampil abu-abu "Belum Ada Data", bukan hijau.
- Skeleton saat memuat, pesan error spesifik dengan tombol "Muat Ulang" hanya untuk
  gagal jaringan/server.
- Aksesibilitas: aria-label ringkasan di tiap baris; status dibedakan dengan teks di
  tooltip dan legenda, tidak hanya warna.
- Responsif: pada layar sempit, ikuti perilaku bar lama (jumlah slot/skala tidak
  diubah oleh baris baru).

E. Performa
- Tidak ada query ke tabel mentah untuk rentang > 24 jam. Target p95 endpoint tetap
  di bawah 300 ms pada data seed 1 tahun dan 20 perangkat, dan tidak lebih lambat
  dari sebelum perubahan (ukur sebelum dan sesudah).

LANGKAH 3 - TES (tampilkan hasilnya)
- Regresi: simpan respons endpoint lama sebelum perubahan, lalu bandingkan dengan
  sesudah. Seluruh field lama harus identik (nilai, tipe, nama). Bar lama dan angka
  uptime tidak berubah. Tampilkan screenshot sebelum/sesudah bagian atas kartu.
- Unit test fungsi status slot untuk kedua baris: semua sukses, gagal sebagian,
  gagal di atas ambang, tanpa data, ping dinonaktifkan di tengah rentang, perangkat
  dibuat di tengah rentang, perangkat nonaktif, slot yang sedang berjalan, slot
  pertama dan terakhir parsial, pergantian hari dan bulan (WIB), celah log di tengah
  slot besar.
- Tes bahwa pesan log yang digabung/dibuang filter tetap dihitung sebagai "diterima"
  sehingga perangkat yang sedang banjir tidak tampak "Tidak Mengirim".
- Tes endpoint: semua kombinasi rentang-skala yang valid mengembalikan jumlah slot
  baris baru SAMA dengan jumlah slot bar lama.
- Simulasi: (a) ping Down 20 menit, log tetap masuk; (b) log berhenti 20 menit, ping
  tetap Up; (c) keduanya mati; (d) perangkat dinonaktifkan 1 jam. Tunjukkan tampilan
  tiap skenario dan pastikan sesuai aturan.
- Uji tampilan untuk rentang 24 Jam, 7 Hari, 30 Hari, 1 Tahun, dan Kustom, serta
  keselarasan kotak antar baris.
- Uji tidak ada fetch ganda: satu request per perubahan pilihan.
- Jalankan lint, typecheck, dan seluruh tes yang sudah ada. Pastikan tidak ada tes
  lama yang gagal.

LAPORAN AKHIR (wajib)
- Daftar file yang diubah/ditambah, dan konfirmasi tertulis bahwa bar lama, perhitungan
  uptime, kontrol, dan komponen lain tidak diubah.
- Jika ada struktur baru (tabel/kolom/job), jelaskan alasan dan cara migrasinya.