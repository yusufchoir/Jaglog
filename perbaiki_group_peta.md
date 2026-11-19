TUGAS: Perbaiki tiga bug pada fitur Grup di Peta Jaringan. Hanya perbaiki yang
disebut di sini. Jangan mengubah fitur, tampilan, atau perilaku lain.

BUG
1. Node anggota grup keluar dari kotak grup. Contoh grup "SEMARANG" (4 anggota): kotak
   hanya memuat satu node; Main Mikrotik dan SEEVER 183 keluar di sisi kanan, LocalHost
   keluar di sisi bawah. Kotak tidak mengikuti posisi dan ukuran anggotanya.
2. Setelah grup dilipat (tombol "Lipat"), grup tidak bisa dibuka lagi; harus refresh
   halaman.
3. Setelah refresh, semua grup selalu terbuka. Status lipat/buka terakhir tidak
   diingat.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah fitur lain: status node, garis, drawer detail, heatmap, widget,
  aturan deteksi, endpoint lama (field respons tidak berubah), tema, dan gaya
  (terang, garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia).
- Status lipat/buka adalah PREFERENSI TAMPILAN, bukan data peta: TIDAK boleh menaikkan
  versi peta, tidak memicu pengecekan konflik, tidak disiarkan lewat SSE ke pengguna
  lain, dan tidak membutuhkan hak admin (viewer pun bisa melipat grup untuk
  tampilannya sendiri).
- Pakai ulang komponen, hook mutasi, SSE, dan antrian simpan yang sudah ada. Tidak
  ada tabel/worker/job duplikat, tidak ada fetch ganda, jangan memakai alert/confirm
  bawaan browser.
- Migrasi aditif dan aman, data lama tidak dihapus.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode dulu)
Tunjukkan bukti dengan file:baris:
a. Bug 1: bagaimana lebar/tinggi/posisi kotak grup ditentukan (nilai tersimpan di
   database, dihitung dari anggota, atau konstanta). Apakah anggota memakai
   parentId (koordinat relatif) atau koordinat absolut. Apakah ukuran kartu node
   dalam perhitungan sama dengan ukuran terukur (measured width/height) di kanvas.
   Kapan kotak dihitung ulang (saat muat, geser node, tambah/keluarkan anggota,
   Rapikan, lipat/buka, perubahan ukuran kartu karena badge insiden). Cetak untuk
   grup SEMARANG: koordinat dan ukuran kotak vs koordinat dan ukuran tiap anggota.
b. Bug 2: tampilan saat grup dilipat: elemen apa yang dirender (node grup tetap ada,
   diganti node ringkasan, atau disembunyikan), apakah tombol "Buka" ada, apakah
   penangan klik terpasang dan tidak tertutup elemen lain (z-index, pointer-events,
   stopPropagation), apakah node grup ikut diberi hidden bersama anggota, dan di mana
   status lipat disimpan (state komponen, state peta, data node). Apakah pembaruan
   SSE atau render ulang mereset status. Apakah ada error di Console saat membuka.
c. Bug 3: apakah status lipat disimpan di mana pun (localStorage, database, URL).
   Cek juga bila "lipat" ternyata disimpan sebagai bagian data peta (jika ya, itu
   sumber konflik versi).
Laporkan akar masalah tiap bug. Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN

A. Kotak grup selalu memuat anggotanya (Bug 1)
- Mode utama "otomatis pas": batas kotak = kotak pembatas (bounding box) dari SEMUA
  anggota yang terlihat, memakai ukuran TERUKUR dari kanvas (bukan konstanta), ditambah
  padding: 24 px kiri/kanan/bawah dan area judul di atas (tinggi sesuai label dan tombol,
  minimal 44 px) agar label tidak menimpa node.
- Hitung ulang batas pada: pemuatan peta, setelah ukuran node terukur, saat node
  digeser (langsung saat drag, tanpa menunggu simpan), saat anggota ditambah atau
  dikeluarkan atau dipindah grup, saat Rapikan/Tempatkan otomatis, saat lipat/buka,
  saat ukuran kartu berubah (mis. badge insiden), dan saat pembaruan peta dari
  admin lain.
- Kotak adalah elemen turunan: ukuran hasil hitung tidak menjadi sumber kebenaran.
  Jika kolom ukuran grup masih disimpan, perlakukan hanya sebagai cache dan jangan
  dipakai untuk menggambar bila bertentangan dengan posisi anggota. Data lama dengan
  ukuran basi harus otomatis terkoreksi saat dimuat tanpa tindakan admin.
- Koordinat konsisten: pilih satu sistem (absolut atau parentId relatif) dan
  gunakan di semua tempat (render, simpan, drag, Rapikan, seed demo). Jika perlu
  konversi data lama, lakukan lewat migrasi/normalisasi saat muat yang aman dan
  idempoten.
- Kotak digambar di belakang node (z-index lebih rendah), tidak menutupi atau
  menghalangi klik pada node dan garis. Label dan tombol Lipat/Buka berada di area
  judul, bukan di atas node.
- Menggeser kotak grup menggeser semua anggota bersama; menggeser anggota membuat
  kotak ikut menyesuaikan (membesar/mengecil). Anggota tidak bisa berada di luar
  kotak dalam keadaan apa pun. Node yang diseret ke atas kotak grup lain menawarkan
  "Pindahkan ke grup X?" lewat konfirmasi inline (komponen yang sudah ada); tanpa
  konfirmasi, node kembali.
- Dua kotak grup tidak boleh saling menimpa: bila terjadi (mis. setelah geser),
  tampilkan peringatan kecil non-blokir dan perbaiki otomatis lewat "Rapikan"
  (tombol yang sudah ada) dengan menjaga jarak minimal 32 px antar kotak.
- Grup dengan 0 anggota tampil sebagai kotak kecil tetap dengan teks "Belum ada
  perangkat"; grup dengan 1 anggota tetap benar.
- Perubahan posisi tetap disimpan lewat antrian simpan dan aturan "terakhir menang
  per elemen" yang sudah ada.

B. Lipat dan buka berfungsi dua arah (Bug 2)
- Satu sumber kebenaran: peta { grupId -> terlipat: boolean } di satu store/hook,
  bukan di state komponen anak.
- Tampilan terlipat: node ringkasan grup yang tetap ada dan tetap dapat diklik,
  berisi nama, "4 anggota - 4 online", status terburuk (teks + glyph), lencana jumlah
  insiden terbuka, dan tombol jelas "Buka". Klik tombol, klik dua kali pada node, atau
  Enter/Spasi saat fokus membuka grup. Ukuran target sentuh >= 44 px.
- Saat terlipat: anggota disembunyikan (bukan dihapus), garis ke/dari anggota
  digabung ke node ringkasan dengan lencana jumlah; data anggota tidak diambil ulang.
- Saat dibuka: anggota kembali tepat di posisi sebelumnya, kotak dihitung ulang
  (poin A), dan garis kembali normal. Tidak ada lompatan zoom/geser kanvas.
- Pembaruan SSE, simpan tata letak, atau render ulang TIDAK boleh mereset status
  lipat/buka. Pastikan penangan klik tidak tertutup elemen lain dan tidak ada error
  di Console.
- Status node di dalam grup terlipat tetap diperbarui (status terburuk, hitungan
  online, lencana) tanpa membuka grup.
- Drawer detail grup: klik node ringkasan terlipat membuka detail grup di drawer
  yang sudah ada (bukan membuka grup); tombol "Buka" yang membuka grup.

C. Status lipat/buka tersimpan (Bug 3)
- Simpan per pengguna per peta di database: tabel user_map_view_state
  (user_id, map_id, collapsed_group_ids jsonb, updated_at), unique (user_id, map_id).
  Gunakan mekanisme preferensi pengguna yang sudah ada bila ada; jangan membuat
  dua sistem.
- Endpoint kecil: GET (ikut dibawa di respons /api/peta sebagai field aditif
  "tampilan": { grup_terlipat: [...] }) dan PUT /api/peta/{id}/tampilan untuk
  menyimpan. PUT didebounce 500 ms, hanya mengirim saat ada perubahan, ukuran
  dibatasi, divalidasi Zod, CSRF, dan dapat dipakai semua peran yang login (admin
  dan viewer) hanya untuk data miliknya sendiri. Tidak menaikkan versi peta,
  tidak memicu SSE.
- Cache lokal (localStorage, kunci per pengguna dan peta) untuk pemulihan instan:
  saat peta dimuat, status dibaca lebih dulu dari cache lokal dan disetujui oleh
  data server begitu tiba; pada render pertama tidak boleh ada kedipan "semua
  terbuka lalu melipat". Bila server dan lokal berbeda, server menang.
- Ingat apa adanya: setelah refresh, buka di tab lain, atau login di perangkat lain,
  grup yang terakhir dilipat tetap terlipat dan yang terbuka tetap terbuka.
- Grup baru yang dibuat default terbuka. Grup yang dihapus dibersihkan dari daftar
  tersimpan (saat muat dan saat dihapus). Jika localStorage tidak tersedia atau
  dikosongkan, pakai data server tanpa error.
- Dua tab pengguna yang sama: perubahan di satu tab tidak memaksa tab lain berubah
  saat sedang dipakai; tab lain memakai status terbaru saat dimuat ulang.
- Status tampil sama di tampilan desktop dan mobile.

D. Aksesibilitas dan performa
- Tombol Lipat/Buka punya aria-expanded dan aria-label berisi nama grup; dapat
  dioperasikan keyboard. Animasi singkat dan halus, dimatikan bila
  prefers-reduced-motion.
- Perhitungan batas kotak efisien (memo, hanya untuk grup yang berubah); 30 grup dan
  300 node tetap mulus. Tidak ada fetch ganda.

LANGKAH 3 - TES (tampilkan hasilnya)
Bug 1:
- Muat peta lama dengan data grup SEMARANG: otomatis terkoreksi, keempat anggota
  berada penuh di dalam kotak dengan padding, label tidak menimpa node.
- Geser anggota ke kanan/bawah jauh: kotak ikut membesar saat itu juga; geser balik:
  kotak mengecil. Tambah anggota baru dan keluarkan anggota: kotak menyesuaikan.
- Geser kotak: semua anggota ikut. "Rapikan": tidak ada anggota keluar kotak, tidak
  ada kotak saling menimpa. Grup 0 dan 1 anggota benar.
- Kartu node membesar karena badge insiden bertambah: kotak tetap memuat.
- Uji di zoom berbeda, mobile 390 px, dan setelah refresh. Verifikasi dengan
  pengecekan otomatis: untuk semua grup, semua anggota berada di dalam batas kotak.
Bug 2:
- Lipat lalu buka berulang 20 kali pada tiap grup: selalu bisa dibuka, anggota
  kembali ke posisi semula persis, garis normal kembali.
- Saat terlipat, kirim pembaruan SSE (status berubah, insiden baru): status
  terburuk dan lencana di node ringkasan berubah, status lipat tidak ter-reset.
- Operasi keyboard (Enter/Spasi), sentuh di mobile, klik dua kali, dan pembaca layar.
- Tidak ada error di Console dan tidak ada request simpan peta yang terpicu.
Bug 3:
- Lipat 2 dari 3 grup, refresh: tepat 2 grup masih terlipat tanpa kedipan.
- Buka di browser/perangkat lain dengan akun sama: status sama. Akun viewer: bisa
  melipat dan statusnya tersimpan; akun lain tidak terpengaruh.
- Hapus localStorage lalu muat: status dipulihkan dari server. Server mati sebentar:
  perubahan tetap tersimpan lokal dan tersinkron saat server pulih tanpa duplikat.
- Hapus grup yang terlipat: tidak ada sisa di data tersimpan. Grup baru default
  terbuka.
- Lipat/buka tidak menaikkan versi peta dan tidak menyebabkan pesan konflik
  (periksa nomor versi sebelum/sesudah).
Regresi:
- Semua fitur peta lain (drawer detail, status langsung, filter, simpan tata letak,
  heatmap, widget, mobile) tampil dan berperilaku sama. Respons endpoint lama
  identik. lint, typecheck, dan seluruh tes lama lulus.
- Tampilkan screenshot sebelum/sesudah grup SEMARANG, keadaan terlipat, dan setelah
  refresh.

LAPORAN AKHIR (wajib)
- Akar masalah ketiga bug, daftar file yang diubah/ditambah, migrasi yang dibuat,
  konfirmasi tertulis bahwa fitur lain tidak berubah, dan keterbatasan yang diketahui.