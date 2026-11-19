TUGAS: Aplikasi sering menampilkan halaman error bawaan Next.js:
"Application error: a client-side exception has occurred (see the browser console for
more information)." Temukan dan perbaiki penyebabnya, lalu tambahkan pengaman supaya
satu error kecil tidak menjatuhkan seluruh halaman. Hanya perbaiki ini.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint
  yang sudah benar. Respons endpoint lama tidak berubah. Tema dan gaya tetap (terang,
  garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia yang spesifik).
- Jangan menyembunyikan error dengan try/catch kosong. Setiap error harus tercatat dan
  penyebabnya diperbaiki; pengaman hanya mencegah satu bagian menjatuhkan semuanya.
- Tidak ada fetch ganda, tidak ada alert/confirm bawaan browser, tidak ada tabel/worker
  duplikat. Pakai ulang komponen, hook mutasi, SSE, dan cache yang sudah ada.
- Data pengguna tidak boleh hilang. Backup sebelum mengubah data apa pun.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode dulu)
A. Kumpulkan bukti dari production build
- Jalankan build production dengan source map (productionBrowserSourceMaps sementara,
  jangan dibuka ke publik) agar stack trace menunjuk file:baris kode sumber.
- Buka SEMUA halaman (/, /perangkat, /perangkat/[id] semua tab, /grup, /grup/[id],
  /peta termasuk Daftar/Metrik NOC/Mode Pantau/mode ubah, /insiden, /pengguna,
  /pengaturan, /login) dan skenario: login/logout, pembaruan langsung masuk saat
  halaman terbuka lama (>30 menit), ubah/hapus grup di tab lain, perangkat
  dinonaktifkan, lipat/buka grup, buka di mobile dan mode PWA, setelah deploy baru
  dengan tab lama masih terbuka. Catat setiap error dengan pesan lengkap, stack
  trace, halaman, pemicu, dan frekuensinya.
B. Periksa kandidat penyebab dan laporkan mana yang terbukti (file:baris):
 1. ChunkLoadError / "Loading chunk failed" / gagal memuat modul setelah redeploy;
    apakah service worker atau cache menyajikan aset versi lama (cek strategi cache
    sw.js, header Cache-Control, dan versi build).
 2. TypeError akibat data tidak terduga dari API/SSE: akses properti pada undefined/
    null, array yang ternyata bukan array, field baru/lama yang berbeda bentuk.
    Telusuri semua titik penerimaan data: respons API, event SSE, data peta,
    status lipat, parameter URL (filter), localStorage.
 3. Peta/React Flow: koordinat NaN/Infinity, parentId tidak ada, node duplikat id,
    grup terhapus tetapi masih dirujuk, urutan parent/anggota, ukuran 0.
 4. Hydration mismatch: tanggal/zona waktu (WIB), Intl/toLocaleString, Date.now(),
    Math.random(), akses window/localStorage saat render, perbedaan render server vs
    klien. Cek peringatan "Hydration failed" dan "Text content does not match".
 5. Data tersimpan rusak: localStorage/sessionStorage, status lipat grup, viewport
    peta, filter tersimpan; parse JSON tanpa validasi.
 6. Pembaruan SSE: event dengan bentuk tidak terduga, handler yang memperbarui state
    komponen yang sudah unmount, render berulang ("Maximum update depth exceeded").
 7. Error di server component/aksi yang bocor ke klien sebagai error generik.
 8. Library/versi: dependensi klien yang bertabrakan, import dinamis yang gagal,
    kode yang hanya aman di browser dijalankan di server (atau sebaliknya).
C. Apakah ada error boundary saat ini (app/error.tsx, app/global-error.tsx, boundary
   per bagian)? Tampilkan bukti bahwa tidak ada atau tidak efektif.
D. Apakah ada pelaporan error klien ke server? (kemungkinan belum)
Laporkan akar masalah yang terbukti, frekuensi, dan halaman terdampak. Berhenti dan
tunggu "lanjut".

LANGKAH 2 - PERBAIKAN

A. Perbaiki akar masalah sesuai bukti Langkah 1 (prinsip wajib):
 1. Data dari luar tidak dipercaya: validasi dengan Zod di sisi klien untuk respons
    API dan payload SSE (field opsional diberi nilai aman, tipe dipaksa, entri tidak
    valid dibuang dan dicatat, bukan membuat render gagal). Pakai optional chaining dan
    nilai default pada tampilan data agar undefined/null tidak melempar error.
 2. Data tersimpan (localStorage, status lipat, viewport, filter URL): baca lewat satu
    fungsi aman yang membungkus parse JSON dengan try/catch, validasi bentuk, dan
    kembali ke default bila rusak (lalu tulis ulang data bersih). Versi skema pada
    data tersimpan agar data lama tidak merusak versi baru.
 3. Peta: transformasi data defensif (koordinat tidak valid -> nilai aman, parentId
    tidak valid -> dilepas dari grup, id ganda -> dibuang), urutan parent sebelum
    anggota, tidak membuat semua node tersembunyi, dan tombol Pusatkan selalu
    berfungsi.
 4. Hydration: render yang bergantung browser (tanggal WIB, waktu relatif, window,
    localStorage) dipindah ke efek klien atau komponen khusus klien dengan nilai
    awal identik server/klien (tampilkan placeholder stabil, lalu perbarui setelah
    mount). Format tanggal memakai satu fungsi terpusat dengan zona Asia/Jakarta
    eksplisit.
 5. SSE/state: bersihkan listener saat unmount, abaikan event untuk entitas yang
    sudah tidak ada, jangan memperbarui state komponen yang sudah unmount, dan cegah
    siklus render (bandingkan nilai sebelum memperbarui).
 6. Chunk/aset lama: tangani ChunkLoadError dan gagal memuat modul dinamis dengan
    memuat ulang halaman SATU KALI otomatis (penjaga di sessionStorage agar tidak
    menjadi loop), disertai pesan jelas "Versi baru aplikasi tersedia. Memuat ulang...".
    Pastikan service worker tidak menyajikan aset versi lama: aset berversi
    cache-first dengan nama berhash, HTML dan API network-only, pembersihan cache lama
    saat aktivasi, dan banner "Versi baru tersedia - Muat ulang" yang sudah ada tetap
    berfungsi. Header Cache-Control untuk sw.js dan halaman HTML: no-cache.
 7. Setiap perbaikan diberi komentar singkat berisi alasan, tanpa mengubah perilaku
    yang sudah benar.

B. Error boundary berlapis (pengaman)
 1. app/global-error.tsx dan app/error.tsx: halaman error yang rapi sesuai tema,
    Bahasa Indonesia, spesifik: "Terjadi kesalahan saat menampilkan halaman ini. Data
    Anda aman." dengan tombol "Coba lagi" (reset boundary), "Muat ulang halaman",
    dan "Kembali ke Ringkasan", serta kode referensi singkat (id error) untuk
    dicocokkan dengan log. Tanpa menampilkan stack trace atau data sensitif ke pengguna.
 2. Boundary per bagian besar: peta (kanvas), drawer detail, grafik/riwayat status,
    Event Log, widget Ringkasan/NOC, daftar perangkat. Bila satu bagian gagal, hanya
    bagian itu yang menampilkan pesan kecil dengan tombol "Coba lagi"; sisa halaman
    tetap berfungsi. Peta yang gagal menawarkan tampilan Daftar sebagai cadangan.
 3. Boundary tidak boleh menimbulkan loop (batasi coba ulang otomatis) dan harus
    mengatur ulang diri saat navigasi.
 4. Penanganan error terpusat untuk promise tak tertangkap dan event "error" /
    "unhandledrejection" di klien: dicatat dan ditampilkan sebagai toast bila
    memengaruhi aksi pengguna, tidak membuat halaman putih.

C. Pelaporan error klien ke server (agar tidak perlu menebak lagi)
 - Endpoint kecil POST /api/client-error (autentikasi sesi; bila belum login, hanya
   menerima set field minimal dengan rate limit ketat). Payload: pesan, nama error,
   stack (dipotong 4 KB), halaman (path tanpa query sensitif), versi build, id error,
   user_agent, waktu, komponen terakhir. DILARANG memuat token, cookie, password,
   isi log mentah, atau data perangkat sensitif.
 - Rate limit per pengguna/IP (maks 20/menit), dedupe error identik dalam 60 detik di
   klien, ukuran dibatasi, validasi Zod.
 - Simpan di tabel client_errors (id, waktu, user_id nullable, path, pesan, stack,
   build, user_agent, jumlah, terakhir_terjadi) dengan penggabungan (upsert) per
   sidik jari error agar tidak membengkak; retensi 30 hari lewat job retensi yang
   sudah ada. Tidak membuat worker baru.
 - Tampilan admin sederhana di /pengaturan (bagian "Kesalahan aplikasi"): daftar error
   terbaru, jumlah kejadian, halaman, versi build, dan tombol "Tandai selesai".
   Hanya admin. Dengan gaya komponen yang sudah ada.
 - Source map untuk production disimpan privat di server (tidak disajikan publik)
   dan dipakai untuk membaca stack trace admin, atau dokumentasikan cara memetakan
   stack ke kode sumber.

D. Pencegahan
 - Aktifkan aturan lint/TypeScript yang menangkap akses tak aman (strict null checks,
   no-unsafe-member-access pada data dari luar) pada kode yang menerima API/SSE.
 - Tes otomatis "tidak ada error konsol" pada alur utama (Playwright): semua halaman
   dimuat tanpa error/warning hydration.
 - Dokumentasikan di README bagian "Pemecahan masalah error klien".

LANGKAH 3 - TES (tampilkan hasilnya)
 - Reproduksi: tunjukkan setiap error asli dari Langkah 1 sebelum dan sesudah
   perbaikan (stack trace, pesan, halaman).
 - Rusak-kan data sengaja: (a) respons API dengan field hilang/null/bertipe salah,
   (b) event SSE dengan bentuk salah, (c) localStorage/status lipat berisi JSON
   rusak dan versi lama, (d) peta dengan koordinat NaN, parentId tidak ada, id ganda,
   grup yang dihapus di tab lain, (e) filter URL tidak valid, (f) tab lama setelah
   deploy baru (ChunkLoadError), (g) tanggal pada zona waktu berbeda antara server
   dan browser. Hasil yang diharapkan: tidak ada halaman error utuh; bagian yang
   bermasalah menampilkan pesan lokal dengan "Coba lagi"; error tercatat di
   client_errors; data yang valid tetap tampil.
 - Paksa error render di tiap bagian (peta, drawer, grafik, Event Log, widget): hanya
   bagian itu yang menampilkan pengaman, sisanya normal, dan "Coba lagi" bekerja.
 - ChunkLoadError: muat ulang otomatis tepat satu kali, tanpa loop; banner versi baru
   tetap muncul bila relevan.
 - Hydration: tidak ada peringatan hydration pada semua halaman (production dan dev).
 - Pelaporan error: error terkirim sekali walau terjadi berulang (dedupe), payload
   tidak memuat token/cookie/data sensitif, rate limit bekerja, viewer tidak bisa
   membuka daftar kesalahan admin, retensi 30 hari berjalan.
 - Uji ketahanan 2 jam: halaman Ringkasan, Peta, dan Event Log terbuka dengan
   pembaruan langsung aktif, tanpa error baru di Console dan memori stabil.
 - Uji mobile dan PWA (Android Chrome dan iOS Safari): tidak ada halaman error utuh.
 - Regresi: semua fitur lain berfungsi dan tampil sama (screenshot sebelum/sesudah),
   respons endpoint lama identik, lint, typecheck, dan seluruh tes lama lulus.

LAPORAN AKHIR (wajib)
 - Akar masalah tiap error yang ditemukan, daftar file yang diubah/ditambah, migrasi
   (client_errors), konfirmasi tertulis bahwa fitur lain tidak berubah, dan daftar
   keterbatasan yang diketahui.