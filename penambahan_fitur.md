TUGAS: Lengkapi JagaLog dengan dashboard visual yang menarik: Peta Jaringan (node dari
perangkat yang sudah ditambahkan) dan widget ringkasan bergaya NOC. Klik node membuka
keterangan detail. Ini PENAMBAHAN fitur, bukan perombakan.

REFERENSI: dashboard bergaya NOC (peta topologi + heatmap + donut status + tabel
ringkasan per jenis + alarm terbaru). Ambil KONSEPNYA, bukan tampilan gelap/penuh warna
miliknya. Tampilan JagaLog tetap mengikuti identitas sendiri di bawah.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah halaman, perhitungan, aturan deteksi, parser, endpoint, atau perilaku
  yang sudah ada. Field respons lama tidak berubah. Penambahan bersifat aditif.
- Pakai ulang data yang sudah ada: status perangkat (online, log berhenti, offline,
  belum ada data), ping dan RTT, insiden, hitungan log per severity, riwayat status,
  analisa AI, pembaruan langsung (SSE), hook mutasi, komponen badge/kartu, dan fungsi
  waktu WIB. Jangan membuat worker atau job baru untuk menghitung ulang yang sudah ada.
- Tidak ada fetch ganda: satu endpoint ringkasan untuk seluruh peta, satu endpoint
  detail yang hanya dipanggil saat node diklik. Pembaruan lewat SSE hanya mengubah node
  yang berubah (setQueryData), tanpa memuat ulang seluruh peta.
- Komunikasi tetap SATU ARAH. Jangan menambah fitur login ke perangkat, SNMP, SSH, atau
  API perangkat. Jangan menampilkan data trafik atau bandwidth karena datanya tidak ada.
  Jangan memalsukan data. Bila sebuah angka tidak tersedia tampilkan "-".
- Tampilan: tema terang (#FAFAF8 latar, #FFFFFF panel, border #E6E4DF, teks #1F2430 dan
  #5B6270). Aksen biru #1F5FBF dan merah #C8372D HANYA sebagai garis hiasan tipis
  (garis atas kartu, garis kiri peringatan, garis hubungan), bukan blok besar.
  Warna status memakai warna legenda yang sudah ada (hijau Online, kuning Log Berhenti,
  merah Offline, abu-abu Belum Ada Data). Font Plus Jakarta Sans dan JetBrains Mono.
  DILARANG: gradient, glow/neon, glassmorphism, emoji, sudut pil besar, ikon dekoratif
  berlebihan. Sudut 4-6 px, border 1 px, bayangan sangat tipis. Terlihat dirancang
  manusia, bukan template. Teks Bahasa Indonesia yang spesifik.
- Status tidak boleh hanya dibedakan dengan warna: tambahkan bentuk/glyph kecil dan
  label teks (Online, Log berhenti, Offline, Belum ada data).
- Hormati prefers-reduced-motion. Animasi hanya halus dan sederhana.
- Tampilan desktop dan mobile (termasuk PWA) harus rapi. Peta tidak di-cache oleh
  service worker.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan dengan file:baris:
a. Halaman Ringkasan saat ini: widget apa yang sudah ada (angka, grafik volume log,
   kartu perangkat, insiden terbaru) dan data/endpointnya.
b. Data status per perangkat yang sudah tersedia (status gabungan, ping, RTT, uptime,
   last_seen_at, jumlah insiden terbuka, hitungan log per severity 24 jam) dan di
   endpoint mana; apakah ada endpoint ringkasan semua perangkat yang bisa diperluas.
c. Tabel devices: kolom lokasi, tipe, dan apakah ada pengelompokan (lokasi/grup/site).
d. Mekanisme SSE yang ada dan tipe event-nya; apakah event perangkat cukup untuk
   memperbarui node tanpa fetch.
e. Library yang sudah dipakai (grafik, state/fetch, UI). Usulan library peta node:
   @xyflow/react (React Flow) untuk kanvas node, plus layout otomatis sederhana
   (dagre) hanya untuk penempatan awal. Jelaskan alasan, ukuran bundle, dan cara
   memuatnya secara dinamis agar tidak membebani halaman lain.
f. Rencana: daftar file yang ditambah/diubah, perubahan skema (kecil dan aditif), dan
   bagaimana menjaga halaman lama tidak terpengaruh.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Skema (aditif, migrasi baru, tanpa mengubah tabel lama selain bila benar-benar perlu)
- topology_maps: id, nama, is_default, created_at. (Satu peta default cukup untuk awal,
  struktur siap untuk banyak peta/situs.)
- topology_nodes: id, map_id, device_id (nullable), tipe_virtual (nullable: internet,
  isp, cloud, switch_tak_terpantau, lainnya), label (untuk node virtual), x, y,
  group_id (nullable), terkunci (bool). Satu perangkat hanya satu node per peta
  (unique map_id + device_id).
- topology_groups: id, map_id, nama, warna_garis (hanya biru/merah/abu), x, y, lebar,
  tinggi. Dipakai sebagai kotak pengelompokan (cabang/lokasi) dengan garis putus-putus.
- topology_links: id, map_id, source_node_id, target_node_id, label (mis. "Fiber 100M",
  "Wireless", "VPN"), tipe (kabel, wireless, vpn, lainnya), unique (source, target).
  Larang link ke diri sendiri dan duplikat. Hapus berantai saat node dihapus.
- Perangkat baru yang ditambahkan di menu Perangkat otomatis muncul di peta sebagai
  node "belum ditempatkan" (tersedia di panel samping untuk diseret ke kanvas), atau
  ditempatkan otomatis di grid bila admin memilih "Tempatkan otomatis".
- Penanda is_demo pada data demo agar mudah dibersihkan.

B. Endpoint (baru, kecil, aditif)
- GET /api/peta?peta_id=...  -> {peta, grup[], node[], link[], ringkasan}
  node ringkas saja: id, device_id, nama, tipe, ip, lokasi, status, ping_status,
  rtt_ms, insiden_terbuka (per severity), versi. Tanpa data berat, tanpa token atau
  rahasia. Satu query teragregasi (tanpa N+1), cache Redis TTL 15-30 detik,
  di-invalidasi oleh event perubahan yang sudah ada.
- GET /api/peta/node/{nodeId}/detail  -> detail penuh, hanya dipanggil saat node
  diklik (lihat poin E). Cache TTL 15 detik, dedupe.
- Perubahan tata letak (hanya admin, divalidasi Zod, CSRF, batas ukuran):
  PUT /api/peta/{id}/layout (posisi node dan grup, dikirim hanya yang berubah),
  POST/DELETE untuk link, grup, dan node virtual. Simpan dengan debounce 800 ms di
  klien; jaga konsistensi dengan nomor versi (tolak penimpaan basi dan beri pesan
  jelas bila dua admin menyunting bersamaan).
- Viewer hanya dapat membaca. Otorisasi di server.

C. Halaman baru /peta (menu "Peta" di navigasi desktop dan "Lainnya"/bar bawah di mobile)
Susunan (desktop):
1. Bilah atas: judul "Peta Jaringan", pemilih peta, pencarian node (fokus dan zoom ke
   hasil), filter status (Online, Log berhenti, Offline, Belum ada data), filter tipe,
   filter lokasi, tombol layar penuh, tombol "Mode Pantau" (tampilan bersih untuk
   layar NOC: tanpa navigasi, kontrol minimal), dan tombol "Ubah tata letak" (admin).
2. Kanvas peta (React Flow, dimuat dinamis):
   - Node kustom berbentuk kartu kecil: ikon SVG buatan sendiri per tipe (MikroTik,
     Windows, Linux, switch, firewall, lainnya, internet/cloud) dengan gaya garis
     konsisten (bukan emoji, bukan ikon generik acak), nama, IP (monospace), RTT.
     Status ditandai cincin/garis tipis berwarna + glyph + label kecil. Garis atas
     tipis biru; berubah merah bila ada insiden critical/high. Lencana angka kecil
     untuk insiden terbuka.
   - Node Offline: cincin merah tipis dan titik status berdenyut halus (dimatikan
     bila prefers-reduced-motion). Log Berhenti: kuning. Belum ada data: abu-abu putus-putus.
   - Garis hubungan: warna mengikuti status ujung terburuk (hijau/biru muda saat
     normal, merah bila salah satu ujung offline, putus-putus abu bila ada ujung
     belum ada data). Label tipe/keterangan di tengah garis. Tidak ada animasi aliran
     trafik palsu.
   - Grup/cabang: kotak dengan garis putus-putus tipis dan label lokasi di pojok,
     dengan hitungan "3 dari 5 online".
   - Zoom, geser, minimap kecil, kontrol zoom/fit, dan tombol "Pusatkan". Hanya render
     elemen yang terlihat (onlyRenderVisibleElements), komponen node di-memo.
     Target mulus untuk 200 node.
   - Mode lihat: node tidak bisa diseret. Mode ubah (admin): seret node, buat link
     dengan menarik dari pegangan node, ubah label link, buat/ubah ukuran grup,
     tambah node virtual (Internet, ISP, Cloud), kunci/lepas node, hapus dengan
     konfirmasi, tombol "Tempatkan otomatis" dan "Rapikan" (layout dagre) dengan
     pratinjau dan tombol Batal/Urungkan (undo/redo sederhana). Perubahan tersimpan
     otomatis dengan indikator "Tersimpan" / "Menyimpan...".
   - Panel samping "Belum ditempatkan": daftar perangkat yang belum punya node, bisa
     diseret ke kanvas.
   - Empty state berguna: "Belum ada perangkat di peta. Tambahkan perangkat di menu
     Perangkat, lalu seret ke sini atau pilih Tempatkan otomatis."
   - Legenda kecil: status dan tipe garis.
3. Hover (desktop): kartu mini berisi nama, status, RTT, log terakhir. Hover tidak
   boleh jadi satu-satunya cara; di sentuh/keyboard gunakan tap/fokus.

D. Widget dashboard bergaya NOC (tambahkan di halaman Ringkasan, di bawah/di samping
   widget yang sudah ada, TANPA mengubah widget lama; atau di /peta bagian bawah bila
   Ringkasan sudah padat. Putuskan di Langkah 1 dan laporkan)
1. Peta mini (pratinjau) dengan tombol "Buka Peta Penuh", hanya-lihat, hemat render.
2. Peta panas (heatmap): satu kotak kecil per perangkat, berwarna sesuai status/risiko
   (hijau Online, kuning Log berhenti, merah Offline, abu Belum ada data, tepi merah
   untuk insiden terbuka). Urutkan dengan yang bermasalah di depan. Hover/tap
   menampilkan nama dan status; klik membuka detail node. Skala sampai 300 perangkat.
3. Donut status: Online, Log berhenti, Offline, Belum ada data, dengan total di tengah
   dan legenda berisi jumlah. Klik segmen memfilter peta/daftar.
4. Ringkasan per jenis perangkat (tabel): Tipe, Jumlah, Online, Bermasalah, Insiden
   terbuka. Klik baris memfilter peta ke tipe itu.
5. Alarm terbaru: donut insiden terbuka per severity (Critical, High, Medium, Low)
   dengan pusat "N Insiden", plus daftar 5 insiden terbaru (judul bahasa awam,
   perangkat, waktu relatif). Klik membuka insiden/ node terkait.
6. Semua widget memakai satu sumber data /api/peta (bagian ringkasan) atau data
   ringkasan yang sudah ada, bukan query baru per widget. Grafik pakai library grafik
   yang sudah dipakai, gaya garis tipis, warna sesuai tema.

E. Detail saat node diklik (drawer kanan di desktop, lembar bawah di mobile)
Tidak menggeser/menutup peta di desktop; node terpilih diberi sorotan tipis dan peta
bergeser halus agar node tetap terlihat. Isi (dari satu endpoint detail):
- Kepala: nama, tipe, badge status (teks + glyph), "sejak 14 menit lalu", IP
  (monospace, tombol salin), lokasi, catatan.
- Kesehatan: ping (Up/RTO, RTT terakhir, mini grafik RTT 1 jam), terakhir mengirim
  log (waktu relatif + tooltip WIB), Uptime 24 Jam dan 7 Hari (rumus yang sama dengan
  kartu riwayat status; "-" bila belum ada data), dan strip riwayat status 24 jam
  ringkas (pakai data yang sudah ada).
- Log: jumlah log 24 jam per severity (Critical, Error, Warning, Info) sebagai bilah
  kecil, laju log terakhir, dan 5 event terbaru (waktu lengkap, severity berlabel,
  pesan terpotong, klik membuka Detail Event Log yang sudah ada).
- Insiden terbuka: daftar singkat (severity, judul bahasa awam, waktu) dengan tautan.
- Analisa AI terbaru: tingkat risiko, ringkasan 1-3 kalimat, 1-3 rekomendasi teratas;
  tombol "Analisa ulang" memakai alur yang sudah ada (admin) dan tetap menghormati
  batas panggilan AI.
- Koneksi: daftar node yang terhubung (dengan status masing-masing) sehingga terlihat
  dampak bila node ini mati; klik pindah ke node itu.
- Aksi: "Buka halaman perangkat", "Lihat Event Log" (rentang 24 jam, perangkat itu),
  "Tes ping sekarang" (memakai fungsi yang sudah ada), "Ubah" (admin). Tombol memakai
  hook mutasi bersama (loading, toast, penanganan error).
- Data sensitif TIDAK ditampilkan: tanpa token, tanpa rahasia channel, tanpa isi raw
  mentah di drawer (hanya di Detail Event Log yang sudah ada).
- Skeleton saat memuat, pesan error spesifik dengan tombol "Muat Ulang" hanya untuk
  gagal jaringan/server. Tutup dengan Esc, tombol tutup, atau klik kanvas kosong.
  Fokus keyboard berpindah ke drawer dan kembali ke node saat ditutup.
- Isi drawer ikut diperbarui langsung lewat SSE (hanya node itu) tanpa mengganggu
  scroll pengguna.

F. Pembaruan langsung
- Gunakan SSE yang sudah ada. Event perangkat.status, perangkat.ping, insiden.berubah,
  perangkat.diubah memperbarui node/garis/widget terkait lewat setQueryData tanpa
  refetch penuh. Perubahan tata letak oleh admin lain disebarkan sebagai event kecil
  "peta.berubah" (id peta + versi); klien yang tidak sedang mengubah mengambil hanya
  bagian yang berubah atau menampilkan chip "Peta diperbarui, muat" bila ia sedang
  mengedit.
- Saat node berubah status, beri kilas tepi halus sekali (tanpa animasi berulang) dan
  bila tab tersembunyi, tidak ada animasi.
- Pembaruan tidak boleh mereset zoom, posisi geser, node terpilih, atau drawer yang
  sedang terbuka.

G. Mobile dan PWA
- Peta dapat dicubit (zoom) dan digeser; tap node membuka lembar bawah dengan detail
  (bisa ditarik ke atas menjadi layar penuh). Kontrol zoom besar (>= 44 px).
- Sediakan tampilan "Daftar" sebagai alternatif peta (toggle Peta | Daftar) yang
  mengelompokkan perangkat per lokasi dengan status; ini juga jalur aksesibel.
- Heatmap dan donut menyesuaikan lebar; widget tersusun satu kolom.
- Mode ubah tata letak hanya di layar >= 768 px (di mobile tampilkan pesan bahwa
  pengeditan peta paling nyaman di layar lebih besar).
- Peta dan /api/peta tidak di-cache service worker.

H. Aksesibilitas
- Node dapat difokus dengan keyboard (Tab/panah), Enter membuka detail, Esc menutup.
  aria-label berisi nama, tipe, dan status. Heatmap dan donut punya alternatif teks
  (tabel/daftar). Kontras WCAG AA. Status tidak hanya lewat warna.

I. Performa
- Kode peta dimuat dinamis hanya di /peta dan widget pratinjau; bundle halaman lain
  tidak membesar (laporkan ukuran sebelum/sesudah). 
- /api/peta p95 < 300 ms untuk 200 perangkat. Satu request saat halaman dibuka dan
  tidak ada polling selama SSE tersambung (fallback polling ringan yang sudah ada
  bila SSE gagal).
- Render 200 node tetap > 50 fps saat geser/zoom pada laptop menengah.

J. Data demo
- Seed demo opsional (bertanda is_demo): satu peta contoh dengan Internet > ISP >
  router utama > 2 switch > beberapa perangkat Windows/Linux di dua cabang, dengan
  campuran status. Hanya dijalankan lewat perintah eksplisit (npm run seed:peta-demo),
  bukan otomatis, dan tidak menyentuh perangkat asli.

LANGKAH 3 - TES (tampilkan hasilnya)
- Regresi: respons endpoint lama sebelum/sesudah identik; halaman lama tampil sama
  (screenshot 1440 px dan 390 px sebelum/sesudah). lint, typecheck, dan seluruh tes
  yang ada lulus.
- Fungsional: perangkat baru muncul di panel "Belum ditempatkan"; seret ke kanvas;
  buat link; ubah label; buat grup; node virtual; hapus; undo/redo; auto-simpan;
  "Tempatkan otomatis" dan "Rapikan". Viewer tidak bisa mengubah (ditolak server).
  Link ke diri sendiri dan duplikat ditolak dengan pesan jelas. Penyuntingan
  bersamaan oleh dua admin menghasilkan pesan konflik, bukan data rusak.
- Klik node: drawer terbuka, isi benar untuk perangkat itu, tidak ada token atau
  data sensitif; satu request detail per klik; klik node yang sama berulang memakai
  cache. Esc/tombol tutup berfungsi, fokus kembali ke node.
- Status langsung: matikan pengiriman log dan ping dari satu perangkat uji -> node,
  garis, heatmap, donut, tabel ringkasan, dan alarm berubah tanpa refresh dan tanpa
  memuat ulang seluruh peta; zoom/geser/drawer tidak ter-reset. Pulihkan -> kembali
  normal.
- Dampak: bila router utama offline, garis ke node di bawahnya tampil merah dan
  daftar "Koneksi" di drawer menunjukkan perangkat terdampak.
- Filter dan pencarian: filter status/tipe/lokasi dan pencarian node bekerja di peta,
  heatmap, dan tabel; klik segmen donut/baris tabel memfilter.
- Mobile 360/390/768: peta bisa dicubit dan digeser, lembar bawah berfungsi, toggle
  Daftar benar, tidak ada scroll horizontal pada body, target sentuh >= 44 px.
- Aksesibilitas: navigasi keyboard, pembaca layar membaca nama dan status, alternatif
  daftar lengkap. Lighthouse Accessibility >= 95.
- Performa: seed 200 perangkat: waktu muat peta, p95 /api/peta, fps saat geser, ukuran
  bundle, dan memori stabil setelah 30 menit dengan pembaruan langsung. Tidak ada
  fetch ganda (cek tab Network).
- Reduced motion: animasi dimatikan.
- Tampilkan screenshot: peta kondisi normal, peta dengan node offline dan insiden,
  drawer detail, mode ubah, heatmap + donut + tabel ringkasan + alarm, tampilan
  mobile (peta, lembar bawah, daftar), dan Mode Pantau.

LAPORAN AKHIR (wajib)
- Daftar file yang ditambah/diubah, migrasi yang dibuat, dan konfirmasi tertulis bahwa
  fitur, perhitungan, dan endpoint lama tidak berubah.
- Tabel metrik performa sebelum vs sesudah dan ukuran bundle.
- Keterbatasan yang diketahui: topologi diatur manual, tidak ada data trafik, dan
  perilaku di perangkat kecil.