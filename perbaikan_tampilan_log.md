TUGAS: Perbaiki urutan, tampilan waktu, dan filter pada tab "Event Log" di detail
perangkat. MELENGKAPI komponen yang sudah ada. Jangan ubah tema, warna, atau fitur
lain.

MASALAH
1. Urutan tidak konsisten: baris 08.38.21 dan 08.37.06 tampil di atas 12.28.07.
   Data harus selalu urut dari yang TERBARU ke terlama.
2. Kolom waktu hanya menampilkan jam, tanpa tanggal.
3. Filter belum ada rentang tanggal/jam. Filter yang ada hanya pencarian teks,
   severity, dan kategori.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode dulu)
- Laporkan kolom mana yang dipakai ORDER BY saat ini (id, received_at, atau
  event_time), dan kolom mana yang ditampilkan di UI.
- Bandingkan event_time dan received_at pada baris yang tampil di screenshot
  (log tes HTTP 08.37/08.38 dan log syslog MikroTik 12.28). Tunjukkan selisihnya.
- Periksa cara event_time diisi untuk syslog MikroTik: dari jam perangkat, dari
  header syslog (RFC 3164 tidak punya tahun dan zona waktu), atau dari waktu server.
  Cek apakah ada kesalahan zona waktu (UTC dibaca sebagai WIB atau sebaliknya),
  dan apakah jam MikroTik meleset.
- Periksa index yang tersedia untuk query daftar log.
Berhenti dan tunggu "lanjut" setelah laporan.

LANGKAH 2 - PERBAIKAN

A. Urutan
- Default urut event_time DESC, id DESC (id sebagai pemutus seri agar stabil).
- Pagination cursor memakai pasangan (event_time, id), bukan OFFSET. Tidak boleh ada
  baris terlewat atau ganda antar halaman.
- Sediakan tombol urutan: "Terbaru dulu" (default) dan "Terlama dulu".
- Gunakan index (device_id, event_time DESC, id DESC). Jika belum ada, buat lewat
  migrasi, dan pastikan EXPLAIN tidak memakai Seq Scan pada tabel besar.

B. Waktu event yang benar
- Aturan tunggal pengisian event_time:
  * Jika perangkat mengirim timestamp yang valid dan selisihnya dengan received_at
    kurang dari 5 menit, pakai timestamp perangkat.
  * Jika timestamp tidak ada, tidak valid, tidak punya tahun/zona waktu yang bisa
    dipastikan, atau selisihnya lebih dari 5 menit (jam perangkat meleset), pakai
    received_at dan simpan waktu asli perangkat di parsed.device_time serta
    tandai parsed.clock_skew_seconds.
  * Simpan semua waktu sebagai UTC. Tampilkan dalam WIB (Asia/Jakarta).
- Tambahkan setting per perangkat: "Zona waktu jam perangkat" (default WIB) untuk
  perangkat yang mengirim waktu lokal tanpa zona.
- Di UI, baris dengan jam perangkat melenceng diberi tanda kecil dengan tooltip:
  "Jam perangkat berbeda 3 jam 51 menit dari server. Waktu yang ditampilkan memakai
  waktu server." Tidak perlu data lama diubah; sediakan tombol admin opsional
  "Perbaiki urutan data lama" hanya jika temuan diagnosis menunjukkan data lama salah.

C. Tampilan tanggal
- Kolom "Waktu (WIB)" menampilkan tanggal dan jam: "05 Nov 2026" pada baris pertama
  dan "08.38.21" di bawahnya (dua baris kecil), atau satu baris "05 Nov 08.38.21".
  Tahun tampil bila bukan tahun berjalan.
- Tambahkan pemisah tanggal di tabel (baris tipis "Kamis, 5 November 2026 - 142 log")
  tiap pergantian hari, sesuai gaya yang sudah ada (garis merah/biru tipis, tanpa
  emoji).
- Tooltip pada waktu menampilkan waktu lengkap WIB dan UTC, plus waktu relatif
  ("3 menit lalu"). Detail baris (raw/parse) menampilkan semua waktu: event_time,
  received_at, device_time.
- Ekspor CSV menyertakan kolom tanggal, jam, zona waktu, dan received_at.

D. Filter
Tambahkan bar filter pada komponen yang sudah ada:
- Rentang cepat (segmen): 15 Menit | 1 Jam | 6 Jam | 24 Jam | 7 Hari | 30 Hari | Kustom
- Kustom: pemilih tanggal + jam awal dan akhir (zona WIB), validasi awal <= akhir,
  tidak melebihi retensi log, pesan error inline yang spesifik.
- Filter tambahan: severity (pilih satu atau lebih, bukan hanya "6 - Informational"),
  kategori, aplikasi/topik (mikrotik, sshd, dll), pencarian pesan, IP sumber, dan
  akun/user. Filter IP dan akun memakai data di kolom parsed.
- Tombol "Reset filter" dan chip filter aktif yang bisa dihapus satu per satu.
- Hasil: tampilkan "Menampilkan 100 dari 1.284 log" (jumlah memakai estimasi/hitungan
  terbatas agar cepat, bukan COUNT(*) penuh pada tabel besar).
- Pilihan filter tersimpan di URL (?rentang=24j&severity=0,1,2,3&q=failed) agar bisa
  dibagikan, dan diingat per pengguna per perangkat.
- Pencarian teks wajib disertai batas waktu (default 24 jam) agar query tetap cepat.
  Jika pengguna memilih rentang sangat lebar dengan pencarian teks, tampilkan
  peringatan singkat.
- Dropdown severity default: tampilkan semua level (0-7) dengan label jelas;
  jelaskan bahwa "6 - Informational" berarti level 6 ke bawah (lebih penting) bila
  itu perilaku sekarang, atau ganti menjadi pilihan ganda agar tidak ambigu.

E. Mode Live
- Saat Live aktif, urutan wajib Terbaru dulu dan filter rentang diabaikan (hanya
  filter severity/kategori/teks). Baris baru muncul di atas, memakai cursor
  (event_time/id lebih baru dari yang terakhir), tanpa memuat ulang seluruh daftar.
- Polling berhenti saat tab tersembunyi. Tidak ada fetch ganda.
- Batasi baris di DOM (misalnya 200); gunakan virtualisasi bila lebih.

F. Performa
- Satu request per perubahan filter (dedupe, keepPreviousData, tidak berkedip).
- Debounce pencarian teks 400 ms.
- Target p95 < 800 ms untuk 5 juta baris dengan filter waktu.

LANGKAH 3 - TES
- Seed data campuran (timestamp perangkat benar, meleset 4 jam, tanpa timestamp, dan
  HTTP tes): daftar selalu urut terbaru ke terlama, tidak ada baris terlewat/ganda
  saat memuat halaman berikutnya.
- Tes tiap rentang cepat dan kustom (termasuk batas tengah malam WIB).
- Tes kombinasi filter (severity banyak + kategori + teks + IP) dan chip reset.
- Tes URL: buka tautan dengan filter, hasil sama.
- Tes mode Live: baris baru muncul di atas, tanpa duplikat.
- Tes ekspor CSV memiliki kolom tanggal dan zona waktu.
- Tampilkan screenshot: urutan baru, pemisah tanggal, bar filter, filter kustom,
  dan tooltip jam perangkat melenceng.
- Jalankan lint, typecheck, dan seluruh tes. Ringkas file yang diubah.