TUGAS: Perbaiki tiga masalah yang muncul setelah perubahan optimasi terakhir:
1. Menu navigasi tidak konsisten antar halaman: di halaman Grup menu hanya
   "Ringkasan, Perangkat, Grup, Peta, Insiden" (tidak ada Pengguna dan Pengaturan).
2. Akun "admin" tampil dengan label peran VIEWER di halaman Grup, tetapi ADMIN di halaman
   Ringkasan. Nama pun berbeda format ("admin" vs "Admin").
3. Dashboard (/) menampilkan "Gagal memuat data ringkasan dashboard." dengan semua angka
   0, dan halaman terus memuat ulang sehingga layar berkedip-kedip.
Hanya perbaiki ini.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint yang
  tidak terkait. Respons endpoint lama tidak berubah (hanya aditif). Tema dan gaya tetap
  (terang, garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia).
- KEAMANAN: prinsip hak akses minimum tetap berlaku. Jangan pernah menaikkan hak akses
  sebagai cadangan (fail-open). Peran yang tidak bisa dipastikan = tidak ada aksi ubah data
  di server, tetapi UI menampilkan status "memeriksa peran", BUKAN label VIEWER.
  Otorisasi tetap diputuskan di server, bukan oleh UI.
- Ukur dulu, baru ubah (build production). Bagian optimasi sebelumnya yang terbukti
  menjadi penyebab: perbaiki, atau matikan lewat feature flag dan laporkan.
- Backup (pg_dump) sebelum mengubah data. Migrasi aditif, idempoten. Tidak ada tabel/worker
  duplikat, tidak ada fetch ganda, tidak ada alert/confirm bawaan browser.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode dulu)
A. Peran dan sesi
 1. Cek tabel users: role akun "admin" sekarang (admin atau viewer?), is_active, dan
    apakah ada migrasi/seed terakhir yang mengubahnya.
 2. Telusuri cara peran dan nama pengguna ditentukan, per halaman: tampilkan file:baris
    untuk layout/navigasi, halaman Grup, halaman Ringkasan, dan komponen header. Apakah
    ada lebih dari satu jalur pengambilan pengguna/sesi (server component, hook klien,
    endpoint /api/me, cookie), dan mengapa nama berbeda format.
 3. Apakah peran disimpan di sesi Redis saat login (bisa basi) atau dibaca ulang dari
    database. Apakah ada cache peran dengan TTL, dan apa yang terjadi bila Redis/DB
    timeout (nilai cadangan "viewer"?). Tampilkan bukti dengan memanggil endpoint sesi
    berkali-kali dan mencatat hasilnya.
 4. Periksa Redis: latensi, kesalahan timeout pada log app, dan batas waktu baru yang
    ditambahkan pada optimasi terakhir (mis. timeout Redis 200 ms, statement_timeout).
 5. Apakah otorisasi server pada halaman Grup benar-benar memperlakukan akun sebagai
    viewer (aksi ditolak) atau hanya tampilannya yang salah.
B. Dashboard dan loop pemuatan ulang
 1. Reproduksi di build production. Catat setiap request dashboard: endpoint, status,
    durasi, pesan error, dan frekuensi (berapa kali per detik). Tunjukkan bukti loop.
 2. Penyebab kegagalan data: query timeout (statement_timeout), kunci cache yang menunggu,
    Redis gagal, pool koneksi DB habis, error pada agregasi/endpoint baru, respons gagal
    validasi Zod, atau 401/403 akibat peran/sesi yang salah. Tunjukkan pesan error server
    dan log app/postgres/redis pada waktu yang sama.
 3. Sumber loop: konfigurasi retry (React Query/SWR retry, refetchInterval, refetchOnMount/
    Focus/Reconnect), error boundary yang memuat ulang atau me-reset berulang, mekanisme
    "resync" SSE yang memicu refetch lalu memicu event lagi, auto-refresh (tombol
    Segarkan otomatis), ChunkLoad reload, redirect login/sesi yang berulang, atau
    fallback polling yang berjalan bersamaan dengan SSE. Tampilkan file:baris.
 4. Apakah satu kegagalan membuat seluruh dashboard menampilkan semua angka 0 (sehingga
    tampak seperti data kosong, bukan error).
C. Hubungan antar masalah: apakah kegagalan sesi/peran menyebabkan dashboard 401/403, atau
   keduanya berasal dari penyebab yang sama (timeout Redis/DB).
Laporkan akar masalah berurutan dengan bukti. Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN

A. Satu sumber kebenaran untuk pengguna, peran, dan navigasi
 - Satu fungsi server getCurrentUser() (id, username, nama tampilan, peran) dipakai oleh
   SEMUA halaman, layout, navigasi, dan otorisasi API. Hasilnya dibagikan lewat satu
   provider di layout; komponen anak tidak mengambil pengguna sendiri-sendiri. Hapus
   jalur pengambilan ganda.
 - Format nama konsisten di semua halaman (satu sumber, satu fungsi format).
 - Peran dibaca dari sumber resmi (database) dan boleh di-cache di Redis dengan TTL
   pendek (<= 60 detik) serta di-invalidasi saat peran/pengguna diubah. Sesi tidak
   menyimpan peran sebagai kebenaran tunggal. Perubahan peran berlaku maksimal sebelum
   TTL habis.
 - Navigasi dibangun dari peran yang sama di semua halaman: admin melihat Ringkasan,
   Perangkat, Grup, Peta, Insiden, Pengguna, Pengaturan; viewer tanpa Pengguna dan
   Pengaturan. Satu komponen navigasi di layout, bukan per halaman.
 - Bila pencarian peran gagal/timeout: gunakan nilai terakhir yang valid dari cache
   (jangan turun ke viewer begitu saja). Bila benar-benar tidak ada nilai, tampilkan
   status netral "Memeriksa peran..." dengan menu minimal dan coba lagi dengan backoff
   (maks 3 kali, lalu pesan "Tidak dapat memeriksa hak akses. Muat ulang." dengan
   tombol). JANGAN menampilkan label VIEWER untuk kondisi gagal dan JANGAN memberi hak
   lebih dari yang dimiliki. Otorisasi server selalu fail-closed (aksi ubah data
   ditolak) pada kondisi gagal.
 - Sesi lama yang berisi peran basi: ditangani oleh aturan baca-dari-sumber di atas;
   tidak perlu memaksa semua pengguna login ulang.
 - Pastikan akun "admin" di database berperan admin (bila ternyata berubah, tampilkan
   temuan dan perbaiki hanya setelah saya setuju). Tidak ada migrasi/seed yang menimpa
   peran pengguna yang sudah ada.

B. Hentikan loop pemuatan ulang dan layar berkedip
 - Retry terbatas: maksimal 2 percobaan ulang otomatis dengan backoff eksponensial
   (1 s, 3 s) dan jitter, lalu BERHENTI dan tampilkan error stabil dengan tombol
   "Coba Lagi". Tidak ada refetch otomatis tanpa batas. Tidak ada refetchInterval
   ketika SSE tersambung. Kegagalan 401/403/4xx tidak di-retry otomatis (401 mengarah
   ke login sekali).
 - Mekanisme resync SSE dibatasi (maksimal 1 resync per 30 detik per tampilan, tidak
   dipicu oleh event milik sendiri atau oleh kegagalan fetch), dan fallback polling
   tidak berjalan bersamaan dengan SSE.
 - Error boundary dan error state tidak boleh me-reset diri atau memuat ulang
   halaman secara otomatis. Tidak ada window.location.reload otomatis kecuali
   penanganan ChunkLoadError satu kali (dengan penjaga).
 - Keadaan error tidak mengganti seluruh konten dengan angka 0. Tampilkan "-" atau
   skeleton pada angka yang tidak tersedia dan pertahankan data terakhir yang valid
   (stale-while-revalidate) dengan penanda "Data mungkin tidak terbaru".
 - Tidak ada kedipan: skeleton berukuran sama dengan konten, data lama tetap tampil
   saat pembaruan, dan perubahan dikelompokkan (batch) agar tidak memicu render
   berulang.
 - Circuit breaker sisi klien: setelah 3 kegagalan berturut-turut pada satu endpoint,
   hentikan permintaan otomatis selama 30 detik (hanya tombol manual yang dapat
   memicu ulang) dan tampilkan pesan yang jelas.

C. Perbaiki penyebab kegagalan data dashboard (sesuai bukti Langkah 1)
 - Timeout dan batas waktu yang terlalu ketat (Redis, kunci cache, statement_timeout)
   disesuaikan berdasarkan pengukuran: nilai realistis dengan jalur cadangan yang
   benar (data cache basi atau hitung ringan dari agregasi), bukan error.
 - Dashboard per widget: satu widget gagal tidak membuat seluruh halaman gagal;
   widget gagal menampilkan pesan kecil dengan "Coba Lagi" sementara widget lain tetap
   tampil.
 - Pool koneksi, query berat, dan kunci cache dari optimasi terakhir diperbaiki atau
   dimatikan lewat feature flag bila terbukti penyebab, dan dilaporkan.
 - Pesan error spesifik: bedakan "Gagal memuat" (server/jaringan), "Sesi berakhir"
   (login ulang), dan "Tidak punya izin".

D. Pencegahan
 - Tes otomatis: peran konsisten di setiap halaman, navigasi sama di semua halaman,
   dan batas jumlah request per halaman (tidak ada loop).
 - Pengamat ringan: log peringatan bila endpoint yang sama gagal > 3 kali per menit
   dari satu klien, dan header Server-Timing seperti sebelumnya.

LANGKAH 3 - TES (tampilkan hasilnya, build production)
 - Akun admin: buka semua halaman (/, /perangkat, /grup, /peta, /insiden, /pengguna,
   /pengaturan, detail perangkat, mode mobile/PWA); label peran, nama, dan menu SAMA di
   semua halaman. Akun viewer: tidak ada Pengguna dan Pengaturan, aksi ubah data
   ditolak server. Label VIEWER hanya untuk akun yang benar-benar viewer.
 - Simulasikan Redis lambat/mati, database timeout, dan pencarian peran gagal: admin tidak
   diturunkan secara keliru ke tampilan viewer, tidak ada hak akses yang bertambah,
   otorisasi server tetap menolak aksi saat peran tidak bisa dipastikan.
 - Ubah peran pengguna di halaman Pengguna: berlaku maksimal dalam TTL; invalidasi cache
   bekerja.
 - Dashboard: matikan satu endpoint widget -> hanya widget itu menampilkan error + Coba
   Lagi, widget lain normal, tidak ada kedipan, jumlah request berhenti setelah batas
   retry (tampilkan log request). Server mati penuh -> pesan stabil, tanpa loop,
   pulih saat server hidup dan tombol Coba Lagi ditekan.
 - Hitung request dashboard per menit pada kondisi gagal: maksimal sesuai batas retry,
   tidak lebih. Tidak ada reload otomatis, tidak ada loop SSE/resync.
 - Tab tersembunyi/kembali, mobile 390 px, mode PWA, dan akun yang login di dua tab.
 - Regresi: semua fitur lain tampil sama (screenshot 1440 px dan 390 px), respons endpoint
   lama identik, lint, typecheck, seluruh tes lama lulus. Tambahkan tes regresi untuk
   konsistensi peran dan batas retry.

LAPORAN AKHIR (wajib)
 - Akar masalah ketiga gejala, apa yang diperbaiki atau dimatikan, daftar file/migrasi,
   lokasi backup, konfirmasi tertulis bahwa fitur lain tidak berubah, dan sisa risiko.