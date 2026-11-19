TUGAS: Satukan data Grup menjadi SATU sumber kebenaran. "Grup di halaman Perangkat/Grup"
dan "grup di Peta" harus menjadi data yang sama: perubahan di satu tempat langsung
terlihat di tempat lain. Sekaligus audit dan hapus semua pengambilan dan pengiriman data
GANDA agar aplikasi ringan.

TEMUAN AWAL DARI SCREENSHOT (jadikan bukti awal, verifikasi di Langkah 1)
- SEEVER 183: grup CYBER di halaman Perangkat, tetapi berada di kotak SEMARANG di Peta.
- MONITORING THE DUDE: grup CYBER di Perangkat; di Peta berada di dalam kotak BPI,
  padahal kotak BPI menampilkan "0 dari 0 online".
- SERVER 1, SERVER 190, SERVER 7, SERVER181: grup CYBER di Perangkat; di Peta tanpa grup.
- WHMCS: grup SEMARANG di Perangkat; tidak ada di kotak SEMARANG di Peta.
- Halaman Perangkat punya 13 grup (termasuk CYBER); Peta hanya punya kotak SEMARANG dan BPI.
Kesimpulan awal: keanggotaan grup tersimpan di dua tempat yang tidak sinkron, dan peta
menentukan anggota berdasarkan posisi gambar, bukan data.

ATURAN KERAS (wajib dipatuhi)
- Hanya menyatukan data grup dan membersihkan pengambilan/pengiriman ganda. Jangan
  mengubah fitur lain, tampilan, tema (terang, garis tipis biru/merah, tanpa gradient,
  glow, emoji), perhitungan, aturan deteksi, parser, atau perilaku yang sudah benar.
- Kolom Lokasi di perangkat TIDAK diubah dan tidak dihapus.
- SATU sumber kebenaran per data: tidak boleh ada salinan nama grup, anggota grup,
  nama/IP/lokasi/status perangkat di tabel peta atau state klien yang bisa berbeda.
- Keanggotaan ditentukan HANYA oleh data (devices.group_id), TIDAK PERNAH oleh posisi
  atau tumpang tindih gambar.
- Backup database (pg_dump) sebelum mengubah data apa pun. Migrasi aman, idempoten,
  bisa diulang, dan TIDAK menghapus data tanpa persetujuan saya. Tabel/kolom lama
  hanya dihapus pada langkah terakhir setelah saya menjawab "setuju".
- Tidak ada fetch ganda, tidak ada pengiriman ganda, tidak ada alert/confirm bawaan
  browser, tidak ada tabel/worker/job duplikat. Pakai ulang komponen, hook mutasi, SSE,
  antrian simpan, dan cache yang sudah ada.
- Status lipat/buka grup tetap preferensi tampilan per pengguna (tidak menaikkan versi
  peta, tidak lewat SSE).
- Respons endpoint lama tidak diubah bentuknya (hanya aditif). Bila sebuah field
  menjadi usang, tandai deprecated dan jangan dihapus pada langkah ini.
- Jika ragu, jangan ubah dan tanyakan.

========================================
LANGKAH 1 - INVENTARIS DAN AUDIT (jangan ubah kode atau data)
========================================
A. Penyimpanan grup
- Daftar semua tabel/kolom yang menyimpan konsep grup atau keanggotaannya: device_groups,
  topology_groups, devices.group_id, topology_nodes.group_id, dan lainnya, beserta
  kolom nama, warna, parent_id, ukuran, dan posisi.
- Cara peta menentukan anggota kotak (data, parentId, atau perhitungan posisi/geometri).
- Apakah topology_nodes atau tabel peta lain menyimpan SALINAN data perangkat atau
  grup (nama, IP, lokasi, label, status).
- Data nyata sekarang: jumlah grup di tiap tabel, nama yang sama/mirip di kedua tabel
  (normalisasi huruf besar/kecil, spasi, garis bawah, tanda hubung), grup kosong,
  nama ganda, node ganda untuk perangkat yang sama, link ganda, referensi yatim.
- Tabel konflik per perangkat: nama perangkat | grup di devices.group_id | grup di peta
  (data) | grup secara visual di peta. Mulai dari perangkat di screenshot di atas.

B. Pengambilan data (BACA), per halaman: /, /perangkat, /grup, /grup/[id], /peta (termasuk
   mode Daftar, Metrik NOC, Mode Pantau, widget pratinjau), detail perangkat, form
   perangkat, dan aksi massal
- Untuk tiap halaman: daftar endpoint/server action yang dipanggil saat muat, kunci cache,
  jumlah request, dan data apa yang diambil lebih dari sekali dalam satu muat
  (mis. daftar perangkat diambil oleh /api/perangkat dan /api/peta; grup oleh /api/grup
  dan /api/peta; ringkasan status diambil per widget).
- Pola N+1 (query per grup/perangkat), data server-component + client yang sama,
  refetch saat fokus/mount yang tumpang tindih, polling yang masih berjalan padahal
  SSE aktif, banyak langganan SSE, dan efek yang berjalan dua kali (bedakan StrictMode
  yang hanya di mode dev dari yang terjadi di production).
- Ukur di build production: jumlah request, ukuran respons, jumlah query SQL
  (pg_stat_statements: calls dan total_exec_time) per muat halaman.

C. Pengiriman data (TULIS)
- Untuk tiap aksi: ubah grup di form perangkat, aksi massal "Pindahkan ke grup",
  tambah perangkat di halaman grup, seret node ke/dari kotak grup di peta, ubah nama/warna
  grup, buat/hapus grup, lipat/buka grup, simpan tata letak: berapa request yang
  dikirim, ke endpoint mana, isi payload (apakah mengirim data yang tidak berubah atau
  seluruh peta/seluruh daftar), dan apakah satu aksi memicu lebih dari satu penulisan
  untuk hal yang sama (mis. update topology dan update devices terpisah).
- Apakah ada debounce/antrian ganda, simpan berulang tanpa perubahan, atau simpan yang
  dipicu oleh event SSE milik sendiri.

D. Hasil: tabel temuan (lokasi file:baris, dampak, usulan) dan baseline terukur
   (request dan query per halaman; request per aksi tulis).
Berhenti dan tunggu "lanjut".

========================================
LANGKAH 2 - RANCANGAN TARGET DAN DRY-RUN MIGRASI (belum mengubah data)
========================================
Rancangan target (sesuaikan hanya bila Langkah 1 membuktikan ada kendala; jelaskan alasan):
- device_groups = SATU-SATUNYA tabel grup (nama, deskripsi, warna_garis biru|merah|abu,
  urutan, parent_id maks 2 tingkat). Unique index pada lower(trim(nama)) setelah
  normalisasi.
- devices.group_id = SATU-SATUNYA tempat keanggotaan (FK, on delete set null, indeks).
  Satu perangkat hanya satu grup.
- Peta tidak menyimpan grup dan keanggotaan. Kotak grup di peta adalah hasil turunan:
  = kotak pembatas dari anggota (devices.group_id = grup itu) yang berada di peta,
  memakai ukuran terukur dari kanvas, dengan padding dan judul (aturan kotak pas yang
  sudah dibuat). Posisi kotak tidak disimpan; menggeser kotak menggeser semua anggotanya.
- topology_nodes hanya menyimpan: map_id, device_id (atau tipe virtual + label untuk
  node virtual), x, y, terkunci. Unique (map_id, device_id). Tanpa kolom group_id,
  tanpa salinan nama/IP/lokasi.
- topology_groups tidak diperlukan lagi. Jika Langkah 1 menemukan data di dalamnya
  yang tidak punya tempat di device_groups, usulkan tempatnya (mis. warna_garis ->
  device_groups). Tabel ini dihapus hanya di langkah terakhir setelah "setuju".
- topology_links tidak berubah.
- user_map_view_state: collapsed_group_ids berisi id dari device_groups.
- Satu model baca (read model) "ringkasan armada": satu fungsi server dan satu query
  teragregasi yang menghasilkan perangkat (id, nama, tipe, ip, lokasi, group_id,
  status gabungan, ping, rtt, last_seen, insiden terbuka per severity) dan grup
  (id, nama, warna, parent_id, jumlah anggota, ringkasan status, insiden terbuka).
  Semua halaman memakai fungsi/endpoint ini: /, /perangkat, /grup, heatmap, donut,
  widget "Per Area", mode Daftar peta, dan hitungan "X dari Y online" di kotak grup.
  Angka grup di mana pun berasal dari satu perhitungan ini sehingga tidak bisa berbeda.
- Peta: /api/peta hanya mengembalikan tata letak (node: device_id/tipe virtual, x, y,
  terkunci; link; versi) plus field tampilan grup_terlipat. Nama, status, dan
  keanggotaan diambil klien dari cache "ringkasan armada" yang sama (digabung di
  memori, bukan diambil ulang).
- Satu jalur tulis keanggotaan: fungsi server setDeviceGroup(device_ids[], group_id|null,
  posisi?) dalam SATU transaksi, dipakai oleh form perangkat, aksi massal, halaman grup,
  dan seret node di peta. Fungsi ini:
  * memperbarui devices.group_id,
  * bila perangkat ada di peta dan posisinya perlu menyesuaikan (dipindah ke grup baru),
    menetapkan posisi baru di topology_nodes di transaksi yang sama (server menempatkan
    di slot kosong dekat anggota grup tujuan, atau memakai posisi yang dikirim klien
    saat drop),
  * menaikkan versi per elemen yang berubah,
  * menerbitkan SATU event SSE "grup.berubah" (jenis: keanggotaan | nama | dibuat |
    dihapus, id yang berubah, versi, client_id pengirim),
  * mengembalikan perangkat dan ringkasan grup yang terdampak agar klien memperbarui
    cache dari respons tanpa fetch ulang.
- Simpan tata letak (PUT layout) hanya mengirim elemen yang BERUBAH (posisi node) dan
  TIDAK memuat keanggotaan maupun nama.
- Operasi grup di peta memakai API/dialog yang sama dengan halaman Grup:
  * "+ Grup" di Alat Penyunting = membuat device_groups sungguhan.
  * Hapus grup dari peta = hapus grup di seluruh aplikasi dengan dialog yang sama
    (pilih lepas anggota atau pindahkan; perangkat tidak pernah ikut terhapus).
  * Seret node ke atas kotak grup lain = konfirmasi inline "Pindahkan ke grup X?"
    lalu setDeviceGroup. Tanpa konfirmasi, node kembali. Seret di dalam grup yang sama
    hanya menyimpan posisi.
- Filter "Semua Area" di toolbar peta memakai device_groups; "Semua Lokasi" tetap
  memakai devices.location.
- Grup kosong: tidak digambar sebagai kotak di peta kecuali punya anggota di peta;
  tetap ada di halaman Grup. Beri opsi "Tampilkan grup kosong" hanya bila diperlukan.

Dry-run migrasi (TAMPILKAN, jangan jalankan):
1. Pencocokan grup: topology_groups -> device_groups berdasarkan nama ternormalisasi
   (huruf besar/kecil, spasi, garis bawah, tanda hubung). Daftar: cocok, tidak cocok
   (akan dibuat sebagai grup baru), dan nama ganda yang akan digabung.
2. Keanggotaan per perangkat. Aturan usulan:
   - devices.group_id terisi -> dipertahankan (halaman Perangkat dianggap data resmi).
   - devices.group_id kosong dan peta punya keanggotaan -> ambil dari peta.
   - Keduanya terisi tetapi berbeda (KONFLIK) -> tampilkan tabel: perangkat | grup di
     Perangkat | grup di Peta | usulan. Default usulan: grup di Perangkat. SAYA yang
     memutuskan per perangkat (mis. SEEVER 183: CYBER atau SEMARANG; MONITORING THE
     DUDE: CYBER atau BPI). Jangan mengubah sebelum saya jawab.
   - Perangkat yang hanya berada di dalam kotak secara VISUAL tanpa keanggotaan data:
     tampilkan sebagai "hanya posisi", tidak otomatis menjadi anggota.
3. Grup kosong dan grup ganda: daftar dan usulan (gabung/pertahankan/hapus).
4. Pembersihan: node ganda untuk satu perangkat, link ganda, referensi yatim,
   kolom/tabel yang akan menjadi usang. Hanya dilaporkan.
5. Dampak: jumlah baris yang berubah per tabel, dan rencana rollback.
Berhenti dan tunggu "setuju" (beserta keputusan konflik saya).

========================================
LANGKAH 3 - IMPLEMENTASI (setelah "setuju")
========================================
A. Backup lalu migrasi data sesuai keputusan saya. Migrasi idempoten dan bertahap
   (tambah dulu, ganti pemakaian, baru hapus belakangan). Pasang constraint: unique
   nama grup ternormalisasi, FK dengan aturan hapus yang benar, unique (map_id,
   device_id) pada topology_nodes. Tabel/kolom lama TIDAK dihapus di langkah ini.
B. Ganti kode agar semua pembaca dan penulis memakai sumber tunggal di atas:
   fungsi baca "ringkasan armada", fungsi tulis setDeviceGroup, dan /api/peta versi
   tata letak. Hapus semua salinan data (nama/IP/lokasi/status/grup) di state peta
   dan tabel peta.
C. Klien: satu kunci cache per entitas (perangkat, grup, tata letak peta, tampilan
   peta). Semua halaman memakai kunci yang sama. Pembaruan dari respons mutasi dan
   SSE memakai setQueryData hanya untuk entitas yang berubah. Tidak ada refetch
   penuh setelah mutasi. Perhitungan "X dari Y online" dan jumlah insiden grup
   diturunkan dari data yang sama.
D. Peta: keanggotaan dari data, kotak turunan, tanpa parentId yang tersimpan; render
   ulang kotak hanya untuk grup yang berubah. Node di dalam kotak secara visual selalu
   anggota data (tidak mungkin berbeda).
E. Realtime: satu event "grup.berubah" memperbarui halaman Perangkat, Grup, Peta,
   heatmap, dan widget lewat cache yang sama. Klien mengabaikan event dari client_id
   sendiri. Perubahan di Perangkat tampak di Peta dan sebaliknya tanpa refresh.
F. Pembersihan pengambilan/pengiriman ganda sesuai tabel temuan Langkah 1:
   - satu request data per entitas per muat halaman, tanpa N+1 (satu query GROUP BY
     untuk ringkasan grup), tanpa polling yang tumpang tindih dengan SSE, satu langganan
     SSE per tab, dedupe permintaan identik, debounce yang tidak berlapis;
   - satu request per aksi tulis, payload hanya yang berubah, tidak ada simpan ulang
     tanpa perubahan, tidak ada simpan yang dipicu event milik sendiri;
   - nonaktifkan duplikasi di server component + klien untuk data yang sama.
G. Validasi dan hak akses: Zod, CSRF, hanya admin yang menulis, viewer hanya membaca
   (diperiksa di server). Batas aksi massal 200 perangkat. Pesan error spesifik
   dalam Bahasa Indonesia ("Nama grup sudah dipakai").
H. Skrip pemeriksa konsistensi `npm run check:data` (hanya baca): mendeteksi nama grup
   ganda, perangkat dengan lebih dari satu node di satu peta, node yatim, link ganda,
   grup yang dirujuk tetapi tidak ada, dan data duplikat lain. Jalankan sebelum dan
   sesudah migrasi; hasil akhir harus bersih.

========================================
LANGKAH 4 - TES (tampilkan hasilnya)
========================================
Konsistensi (dua jendela browser, halaman Perangkat dan Peta terbuka bersamaan):
- Ubah grup SEEVER 183 di form perangkat -> di Peta node pindah ke kotak grup baru
  tanpa refresh dan tanpa mereset zoom/geser; hitungan "X dari Y online" kedua grup
  benar di mana pun.
- Seret node di Peta ke kotak lain + konfirmasi -> kolom Grup di halaman Perangkat
  berubah tanpa refresh. Aksi massal pindah 50 perangkat -> Peta dan Perangkat sama.
- Ubah nama/warna grup, buat grup, hapus grup (opsi lepas dan pindah) di Perangkat
  atau di Peta -> keduanya sama. Perangkat tidak pernah terhapus.
- MONITORING THE DUDE: keanggotaan mengikuti data; kotak BPI tidak lagi menampilkan
  "0 dari 0" bila ia anggota, dan node di dalam kotak secara visual selalu anggota.
- Nama grup ganda ditolak. Perangkat tidak bisa di dua grup.
- Angka grup identik di: halaman Perangkat, Grup, Peta, heatmap, donut, widget
  "Per Area", dan drawer (uji otomatis yang membandingkan semuanya).
- Hak akses: viewer tidak bisa mengubah (ditolak server). Konflik edit bersamaan oleh
  dua admin menampilkan banner non-blokir, bukan data rusak.
Pengambilan dan pengiriman data (build production, tab Network + pg_stat_statements):
- Tabel SEBELUM vs SESUDAH untuk: / , /perangkat, /grup, /peta, detail perangkat.
  Target: setiap entitas diambil maksimal 1 kali per muat halaman, tidak ada endpoint
  yang sama dipanggil dua kali, tidak ada N+1, jumlah query SQL per muat berkurang
  minimal 40% dari baseline, tidak ada polling yang bersamaan dengan SSE.
- Aksi tulis: pindah grup dari form, dari aksi massal, dan dari peta masing-masing
  tepat 1 request mutasi dan 0 refetch penuh; simpan tata letak hanya mengirim elemen
  berubah; tidak ada request simpan bila tidak ada perubahan.
- Tab tersembunyi: koneksi SSE ditutup setelah 60 detik; tab kembali terlihat memicu
  resync hanya tampilan aktif.
- Seed 300 perangkat dan 30 grup: p95 /api/ringkasan-armada dan /api/peta < 300 ms,
  memori stabil 30 menit, tidak ada kebocoran listener.
Regresi:
- Semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan 390 px sebelum/
  sesudah): drawer detail, status langsung, filter, Mode Pantau, Metrik NOC, lipat/buka
  grup (tersimpan setelah refresh), kotak grup selalu memuat anggotanya, mobile/PWA.
  Respons endpoint lama identik. lint, typecheck, seluruh tes lama lulus.
- `npm run check:data` bersih. Tambahkan tes otomatis untuk: sinkron dua arah, tidak ada
  salinan data, dan batas jumlah request per halaman/aksi.

========================================
LANGKAH 5 - PEMBERSIHAN AKHIR (hanya setelah saya menjawab "setuju")
========================================
- Hapus topology_groups, kolom topology_nodes.group_id, dan kode/field usang lain yang
  sudah tidak dipakai (tampilkan daftar dan ukuran yang kembali). Hapus field deprecated
  hanya bila tidak ada klien yang memakainya.
- Jalankan VACUUM ANALYZE pada tabel terdampak. Hapus indeks yang tidak terpakai.

LAPORAN AKHIR (wajib)
- Akar masalah ketidaksinkronan, desain sumber tunggal, daftar file/migrasi yang
  diubah/ditambah, hasil keputusan konflik, tabel sebelum vs sesudah (request, query,
  ukuran respons), hasil check:data, lokasi backup, dan konfirmasi tertulis bahwa
  fitur lain tidak berubah.