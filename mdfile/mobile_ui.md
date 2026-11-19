TUGAS: Buat JagaLog nyaman dipakai di HP (tampilan mobile) dan bisa dipasang sebagai
PWA (Add to Home Screen). Ini penambahan lapisan responsif + PWA, bukan perombakan.

ATURAN KERAS (wajib dipatuhi)
- Tampilan desktop (>= 1024 px) harus TIDAK BERUBAH sama sekali: tata letak, warna,
  teks, perilaku. Semua perubahan memakai breakpoint/media query atau komponen yang
  hanya aktif di layar kecil.
- Jangan mengubah logika bisnis, endpoint, bentuk respons API, perhitungan, aturan
  deteksi, parser, atau pembaruan langsung (SSE). Jangan membuat endpoint, tabel, atau
  worker baru kecuali yang diminta di bawah.
- Satu basis kode: tidak ada aplikasi mobile terpisah dan tidak ada duplikasi
  halaman. Komponen yang sama dipakai ulang; hanya presentasinya yang menyesuaikan.
- Tidak boleh ada fetch ganda: data tidak diambil dua kali karena ada dua versi
  tampilan (jangan render versi desktop dan mobile sekaligus lalu menyembunyikan salah
  satu dengan CSS bila keduanya memicu fetch). Pilih per breakpoint satu komponen
  yang aktif, atau satu komponen yang beradaptasi.
- Gaya tetap: tema terang (#FAFAF8 / #FFFFFF / border #E6E4DF), aksen biru #1F5FBF dan
  merah #C8372D hanya sebagai garis hiasan tipis, Plus Jakarta Sans dan JetBrains
  Mono, tanpa gradient, glow, emoji, atau sudut pil besar. Terlihat dirancang
  manusia, bukan template. Teks Bahasa Indonesia yang spesifik.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan dengan file:baris:
a. Layout global: header/navbar, sidebar, container, dan breakpoint yang dipakai.
b. Daftar halaman dan komponen, lalu tandai yang bermasalah di lebar 360, 390, dan
   768 px: tabel lebar (perangkat, Event Log, insiden, pengguna), grid kartu,
   grafik, bar riwayat status 48-96 slot dan dua baris ping/log, filter Event Log,
   modal Detail Event Log, form perangkat, tab detail perangkat, panel "Cara
   mengirim log", panel analisa AI, halaman login.
c. Elemen yang tidak ramah sentuh: target < 44x44 px, tooltip yang hanya muncul saat
   hover, kontrol kecil, jarak rapat.
d. Meta viewport, penanganan safe area (notch), tinggi 100vh, input yang memicu zoom
   otomatis di iOS (font < 16 px).
e. Apakah sudah ada manifest, service worker, ikon, favicon, atau library PWA.
f. Konfigurasi CSP, header keamanan, dan middleware autentikasi (agar service worker
   dan manifest tidak diblokir), serta bagaimana SSE dan sesi cookie bekerja.
g. Usulan rencana: daftar file yang diubah/ditambah, dan pilihan library service
   worker (Serwist atau SW kustom sederhana) beserta alasannya.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Fondasi responsif
- Viewport: width=device-width, initial-scale=1, viewport-fit=cover.
- Safe area: padding env(safe-area-inset-*) pada header, navigasi bawah, dan modal.
- Gunakan dvh/svh (bukan 100vh). Cegah scroll horizontal pada body.
- Input, select, dan textarea minimal font 16 px di mobile (hindari zoom otomatis iOS).
- Target sentuh minimal 44x44 px, jarak antar tombol minimal 8 px.
- Semua info yang sekarang hanya ada di tooltip hover harus bisa diakses lewat tap
  (popover) dan fokus keyboard. Hover tidak boleh jadi satu-satunya cara.
- Hormati prefers-reduced-motion. Tanpa animasi berat.

B. Navigasi mobile (< 768 px)
- Navigasi atas yang sekarang diganti pada layar kecil dengan:
  * Header ringkas: logo, judul halaman, indikator koneksi, menu akun.
  * Bar navigasi bawah (tetap): Ringkasan, Perangkat, Insiden, Lainnya. "Lainnya"
    membuka lembar bawah berisi Pengguna, Pengaturan (sesuai role), Keluar, dan versi.
  * Badge hitungan kecil pada Insiden bila ada insiden terbuka (data yang sudah ada).
- Gaya: garis tipis biru di atas bar bawah, aksen merah hanya untuk badge/peringatan.
- Di detail perangkat, tab (Ringkasan, Event Log, Insiden, Analisa, Konfigurasi)
  menjadi baris tab yang bisa digeser horizontal dengan tab aktif otomatis terlihat,
  dan mengingat tab terakhir di URL.
- Tombol kembali jelas pada halaman detail.

C. Halaman per halaman (hanya presentasi)
1. Ringkasan: kartu angka tersusun 2 kolom, grid kartu perangkat 1 kolom, grafik
   volume log dengan tinggi lebih rendah dan sumbu disederhanakan, daftar insiden
   terbaru sebagai kartu.
2. /perangkat: tabel menjadi daftar kartu (nama, tipe, IP monospace, status online/
   ping, terakhir terlihat, jumlah log, insiden terbuka). Tombol Tambah perangkat
   mengambang atau di header. Aksi (nonaktifkan, buat ulang token) lewat menu
   titik tiga dan lembar bawah dengan konfirmasi jelas. Token ditampilkan di modal
   layar penuh dengan tombol Salin besar.
3. Detail perangkat: header ringkas yang bisa menyusut saat scroll (nama, status,
   ping, RTT), tombol aksi dalam menu.
4. Event Log: setiap log menjadi kartu padat (waktu lengkap WIB, badge severity
   berlabel teks, aplikasi, pesan dengan potong 2-3 baris dan "selengkapnya").
   Filter dipindah ke lembar bawah "Filter" (rentang cepat, kustom, severity,
   kategori, IP, akun, pencarian) dengan chip filter aktif di atas daftar dan tombol
   Reset. Pencarian tetap terlihat di atas. Mode Live dan chip "N log baru" tetap
   berfungsi. Daftar divirtualisasi (render <= 100 item DOM). Detail log membuka
   lembar penuh dengan raw, JSON, dan waktu, bisa digulir, tombol salin.
5. Riwayat status: bar utama dan dua baris (ping, pengiriman log) tetap berhimpitan
   dan sejajar. Di layar sempit jumlah slot disesuaikan ke atas skala agar tiap
   kotak >= 8 px (gunakan logika skala otomatis yang sudah ada, bukan fungsi baru
   yang bertentangan). Kontrol Rentang menjadi segmen yang bisa digeser, Skala dan
   Kustom lewat lembar bawah. Tooltip menjadi popover saat tap dan bisa digeser antar
   kotak.
6. Insiden: kartu dengan severity, judul bahasa awam, perangkat, waktu, status; ubah
   status lewat lembar bawah; bukti dan rekomendasi AI sebagai panel yang bisa
   dibuka.
7. Analisa AI: ringkasan, temuan, rekomendasi berurutan prioritas; blok perintah
   (command) bisa digulir horizontal dengan tombol Salin yang besar.
8. Pengaturan, Pengguna, Konfigurasi Perangkat, panel "Cara mengirim log": form satu
   kolom, label di atas input, tombol simpan menempel di bawah layar (sticky) di atas
   navigasi bawah, blok kode bisa digulir.
9. Login: satu kolom, kolom password dengan tombol tampilkan, autofill dan manajer
   password berfungsi (autocomplete yang benar).
- Tabel yang tetap harus tabel (mis. ekspor/daftar panjang) dibungkus kontainer
  overflow-x dengan kolom pertama menempel.
- Grafik: sentuh untuk melihat nilai, tanpa menangkap scroll halaman secara tidak
  sengaja.

D. PWA
1. Manifest (app/manifest atau manifest.webmanifest):
   - name "JagaLog", short_name "JagaLog", description Bahasa Indonesia,
     start_url "/?source=pwa", scope "/", display "standalone", orientation "any",
     lang "id", theme_color "#FAFAF8" (selaras dengan header), background_color
     "#FAFAF8", id stabil.
   - Ikon: 192, 512 (any) dan 512 maskable, serta apple-touch-icon 180, favicon.
     Desain sederhana sesuai identitas (kotak biru kecil + huruf/logo JagaLog,
     garis tipis merah), tanpa gradient. Buat sebagai file SVG sumber lalu hasilkan
     PNG; jelaskan cara membuat ulang.
   - Shortcuts: "Perangkat" (/perangkat) dan "Insiden" (/insiden).
   - Tambahkan meta apple-mobile-web-app-capable, status-bar-style, dan judul.
2. Service worker (Serwist atau SW kustom, pilih sesuai Langkah 1; tanpa dependensi
   berat):
   - Lingkup "/". Didaftarkan hanya di production dan setelah halaman dimuat.
   - Strategi cache yang AMAN:
     * Aset statis berversi (/_next/static, font, ikon): cache-first.
     * Halaman HTML dan SEMUA /api/*: network-only (JANGAN di-cache) karena berisi
       data sesi dan data perangkat. Tidak ada data log, token, atau respons
       terautentikasi yang pernah masuk Cache Storage.
     * /api/stream (SSE) dan /api/ingest: dilewatkan penuh oleh service worker
       (tidak diintersep sama sekali).
     * Permintaan non-GET: tidak diintersep.
   - Halaman offline: /offline (statis, tanpa data sensitif) berisi pesan jelas
     "Tidak ada koneksi. Data terbaru memerlukan internet." dengan tombol Coba Lagi
     dan status koneksi. Ditampilkan hanya saat navigasi gagal karena offline.
   - Saat logout: kosongkan Cache Storage yang relevan dan batalkan sesi lokal.
   - Pembaruan versi: SW baru menunggu; tampilkan toast kecil "Versi baru tersedia"
     dengan tombol "Muat ulang" (skipWaiting hanya atas persetujuan pengguna),
     supaya halaman yang sedang dipakai tidak tiba-tiba berganti.
   - Versi cache memakai hash build; cache lama dibersihkan saat aktivasi.
3. Indikator offline/online: banner tipis di bawah header saat offline
   ("Offline - menampilkan tampilan terakhir, data tidak diperbarui"); pada mode
   offline tombol aksi yang mengubah data dinonaktifkan dengan penjelasan.
   Sambungan ulang otomatis memanggil mekanisme resync yang sudah ada (jangan
   menambah polling baru).
4. Ajakan pasang aplikasi:
   - Android/Chrome: tangkap beforeinstallprompt, tampilkan tombol "Pasang aplikasi"
     di menu Lainnya (bukan pop-up mengganggu). Sembunyikan setelah terpasang atau
     bila ditutup (ingat 30 hari).
   - iOS/Safari: petunjuk singkat di menu Lainnya "Bagikan lalu Tambahkan ke Layar
     Utama" (deteksi iOS non-standalone).
   - Tidak tampil bila sudah berjalan dalam mode standalone.
5. Mode standalone: halaman tidak boleh bergantung pada tombol kembali browser;
   pastikan setiap halaman punya navigasi kembali sendiri. Tautan keluar domain
   dibuka dengan benar. Pull-to-refresh bawaan tidak boleh merusak daftar Live.
6. CSP dan header: izinkan manifest, service worker, dan ikon (worker-src 'self',
   manifest-src 'self'). Sajikan sw.js dengan Cache-Control no-cache dan
   Service-Worker-Allowed bila perlu. Manifest dan ikon bisa diakses tanpa login
   (hanya aset publik), sedangkan halaman tetap dilindungi middleware.
7. Notifikasi push (OPSIONAL, kerjakan hanya bila saya setujui setelah laporan
   Langkah 1): Web Push untuk event ping RTO, perangkat offline/pulih, dan insiden
   critical memakai VAPID (env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT),
   tabel push_subscriptions (user_id, endpoint, keys terenkripsi, user_agent,
   created_at), tombol "Aktifkan notifikasi di perangkat ini" di menu Lainnya,
   pengaturan per jenis event, dan memakai antrian notifikasi serta anti-spam yang
   sudah ada (tidak membuat logika pemicu baru). Subscription kedaluwarsa (410)
   dihapus otomatis. Catat bahwa di iOS push hanya bekerja setelah aplikasi dipasang
   ke Layar Utama (iOS 16.4 ke atas).

E. Performa mobile
- Bundle halaman utama < 200 KB gzip (JS); pecah kode untuk grafik dan halaman jarang
  dipakai (dynamic import). Gambar/ikon dioptimalkan. Font dimuat dengan
  font-display swap dan subset.
- Hindari re-render berat saat pembaruan langsung; virtualisasi daftar panjang.
- Target Lighthouse mobile: Performance >= 85, Accessibility >= 95, Best Practices
  >= 95, dan audit PWA/installable lolos.
- Pastikan tidak ada fetch ganda di mobile (cek tab Network pada emulasi).

F. Aksesibilitas
- Kontras WCAG AA, fokus keyboard terlihat, label ARIA untuk navigasi bawah, lembar
  bawah (focus trap, tombol tutup, Esc), dan bar riwayat status. Status tidak hanya
  dibedakan lewat warna. Dukungan perbesaran teks sampai 200% tanpa elemen terpotong.

LANGKAH 3 - TES (tampilkan hasilnya)
- Regresi desktop: tangkap layar semua halaman utama di 1440 px sebelum dan sesudah;
  harus identik. Jalankan lint, typecheck, dan seluruh tes yang ada; tidak boleh ada
  yang gagal. Respons semua endpoint tidak berubah.
- Uji tampilan di lebar 360, 390, 430, 768, dan landscape untuk SEMUA halaman pada
  daftar C; tidak ada scroll horizontal pada body, tidak ada teks terpotong, tidak
  ada elemen tertutup navigasi bawah atau notch. Sertakan screenshot.
- Uji sentuh: semua target >= 44 px, tooltip dapat dibuka dengan tap, lembar bawah
  dan filter berfungsi, Event Log Live + chip "N log baru" berjalan, scroll tidak
  melompat saat pembaruan datang.
- Uji PWA:
  * Lighthouse PWA/installable lolos, manifest valid, ikon maskable benar.
  * Install di Android Chrome dan Add to Home Screen di iOS Safari; terbuka mode
    standalone dengan status bar dan safe area benar.
  * Offline: halaman /offline tampil; tidak ada data log/perangkat/token tersimpan
    di Cache Storage atau IndexedDB (verifikasi isi Cache Storage). Respons /api/*
    dan /api/stream tidak pernah di-cache atau diintersep.
  * Logout membersihkan cache. Pengguna lain di perangkat yang sama tidak melihat
    data pengguna sebelumnya.
  * Update versi: deploy versi baru -> toast "Versi baru tersedia" muncul, halaman
    yang sedang dipakai tidak berganti sendiri.
  * Sesi berakhir di PWA -> diarahkan ke /login dengan pesan yang sama seperti web.
- Uji pembaruan langsung di mobile: SSE tersambung, tab di latar belakang menutup
  koneksi setelah 60 detik, saat kembali ke aplikasi terjadi resync hanya untuk
  tampilan aktif.
- Uji di perangkat nyata (minimal satu Android dan satu iPhone) dan laporkan hasilnya,
  atau jelaskan jika tidak tersedia dan sertakan emulasi sebagai gantinya.
- (Bila push disetujui) Uji langganan, pengiriman, klik membuka halaman perangkat
  yang benar, dan penghapusan langganan kedaluwarsa.

LAPORAN AKHIR (wajib)
- Daftar file yang ditambah/diubah, konfirmasi tertulis bahwa tampilan desktop, logika,
  dan endpoint tidak berubah, serta tabel skor Lighthouse sebelum vs sesudah.
- Catatan konfigurasi Coolify/Traefik (HTTPS wajib, header untuk sw.js dan manifest)
  dan cara menguji instalasi.
- Daftar keterbatasan yang diketahui (mis. perilaku iOS).