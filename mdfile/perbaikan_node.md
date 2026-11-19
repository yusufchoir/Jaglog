TUGAS (dua bagian, kerjakan berurutan):
BAGIAN 1 - Perbaiki bug: node di Peta Jaringan tidak bisa diedit, selalu muncul alert
          "Peta telah diperbarui oleh administrator lain. Silakan segarkan peta
          sebelum menyimpan perubahan Anda." dan status tetap "Menyimpan...".
BAGIAN 2 - Tambah fitur Grup/Area untuk perangkat yang berada di area yang sama.

ATURAN KERAS (wajib dipatuhi)
- Hanya memperbaiki bug dan menambah fitur di atas. Jangan mengubah fitur, tampilan,
  perhitungan, aturan deteksi, parser, atau endpoint lain. Respons endpoint lama tidak
  berubah (hanya aditif). Tema dan gaya tetap (terang, garis tipis biru/merah, tanpa
  gradient/glow/emoji, Bahasa Indonesia yang spesifik).
- Pakai ulang komponen, hook mutasi, SSE, dan struktur yang sudah ada. Jangan membuat
  tabel, worker, atau job duplikat. Tidak ada fetch ganda.
- Jangan menghapus data yang ada. Migrasi harus aman dan dapat diulang.
- Jika ragu, jangan ubah dan tanyakan.

========================
BAGIAN 1 - PERBAIKAN BUG
========================
LANGKAH 1.1 - DIAGNOSIS (jangan ubah kode dulu)
Reproduksi di build production dan tunjukkan buktinya:
- Di DevTools > Network, catat setiap request simpan tata letak (PUT /api/peta/{id}/layout
  dan endpoint node/link/grup): status (200/409), body permintaan (terutama nomor versi
  yang dikirim), dan body respons (nomor versi baru).
- Apakah klien memperbarui nomor versi lokal dari respons setelah setiap simpan
  berhasil? Tunjukkan file:baris.
- Apakah ada lebih dari satu simpan berjalan bersamaan (debounce 800 ms vs request yang
  belum selesai)? Tunjukkan urutan waktu.
- Apakah event SSE "peta.berubah" dari simpan sendiri memicu pesan konflik atau muat
  ulang? Apakah event membawa identitas pengirim (client id)?
- Apakah versi dipakai per peta (satu angka) sehingga setiap pergeseran satu node
  menaikkan versi seluruh peta?
- Apakah ada tab/sesi lain yang membuka peta yang sama saat tes?
- Dari mana pesan alert() berasal dan kenapa status berhenti di "Menyimpan...".
Laporkan akar masalah dengan file:baris dan bukti. Berhenti dan tunggu "lanjut".

LANGKAH 1.2 - PERBAIKAN (sesuai hasil diagnosis; prinsip di bawah wajib)
a. Pisahkan jenis perubahan:
   - Perubahan POSISI/UKURAN (node, grup): TIDAK memakai penolakan konflik. Terapkan
     "yang terakhir menang per elemen" (per node atau grup), dengan updated_at per
     elemen. Server hanya memperbarui elemen yang dikirim. Pergeseran dua node berbeda
     oleh dua admin tidak boleh saling menolak.
   - Perubahan STRUKTUR (tambah/hapus node, link, grup, ubah keanggotaan grup): boleh
     memakai pengecekan versi per elemen (bukan satu versi untuk seluruh peta), dan
     bila konflik terjadi, server mengembalikan keadaan terbaru elemen itu.
b. Antrian simpan di klien: satu permintaan berjalan pada satu waktu. Perubahan yang
   datang saat ada permintaan berjalan digabung (coalesce) menjadi satu permintaan
   berikutnya dengan data terbaru. Setelah respons sukses, perbarui versi/updated_at
   lokal dari respons sebelum permintaan berikutnya dikirim.
c. Setiap klien punya client_id (dibuat per tab). Permintaan simpan membawa client_id,
   dan event SSE "peta.berubah" membawa client_id pengirim serta versi. Klien
   mengabaikan event dari client_id miliknya sendiri dan event dengan versi <= versi
   lokal. Hanya event dari klien lain yang menampilkan chip non-blokir
   "Peta diperbarui oleh pengguna lain. Muat" bila pengguna sedang mengedit; bila tidak
   sedang mengedit, terapkan perubahan itu diam-diam (hanya elemen yang berubah).
d. Konflik nyata (jarang): JANGAN gunakan alert()/confirm() bawaan browser. Tampilkan
   toast/banner inline non-blokir: "Elemen ini baru saja diubah pengguna lain. Muat
   perubahan terbaru atau timpa dengan versi Anda." dengan dua tombol. Tidak boleh
   menahan status di "Menyimpan...".
e. Status simpan yang jujur: "Tersimpan" setelah sukses, "Menyimpan..." hanya selama
   permintaan berjalan, "Gagal menyimpan. Coba lagi" dengan tombol Coba Lagi bila
   gagal. Timeout permintaan 15 detik. Perubahan lokal tidak hilang saat gagal; coba
   ulang otomatis dengan backoff dan tidak membuat duplikat.
f. Pastikan peta yang sama di dua tab milik pengguna yang sama tidak memicu konflik
   palsu (identitas klien berbeda, aturan poin a berlaku).
g. Tambahkan juga: node tidak boleh saling menimpa total saat ditempatkan (geser
   otomatis kecil bila posisi baru tumpang tindih persis), tanpa mengubah tombol
   "Rapikan" yang ada.
h. Hapus semua pemakaian alert/confirm/prompt bawaan di fitur peta dan ganti dengan
   komponen dialog/toast yang sudah ada.

LANGKAH 1.3 - TES BAGIAN 1
- Seret satu node 20 kali berturut-turut dengan cepat: tidak ada pesan konflik, status
  berakhir "Tersimpan", posisi tersimpan, tidak ada lebih dari satu permintaan
  berjalan bersamaan.
- Edit node, link, dan grup berturut-turut (satu admin): tidak ada konflik palsu.
- Dua tab admin yang sama dan dua admin berbeda: menggeser node berbeda tidak
  menimbulkan penolakan; mengubah elemen yang sama menampilkan banner non-blokir,
  bukan alert.
- Event SSE dari simpan sendiri diabaikan; dari klien lain diterapkan hanya untuk
  elemen yang berubah tanpa mereset zoom, geser, atau node terpilih.
- Simulasi jaringan putus saat menyimpan: status "Gagal menyimpan", perubahan lokal
  utuh, coba ulang berhasil tanpa duplikat.
- Viewer tetap tidak bisa mengubah. Regresi: lint, typecheck, seluruh tes lama lulus.

=========================================
BAGIAN 2 - FITUR GRUP/AREA PERANGKAT
=========================================
LANGKAH 2.1 - INVENTARIS (jangan ubah kode dulu; boleh digabung dengan laporan 1.1)
Laporkan: kolom location di devices (nilai yang ada dan variasinya, contoh
"MAIN_BPI"), tabel topology_groups yang sudah ada, tempat filter lokasi dipakai
(Perangkat, Peta, dashboard, Event Log, Insiden, notifikasi), dan usulan agar
konsep "grup di peta" dan "grup perangkat" satu sumber, bukan dua yang terpisah.
Berhenti dan tunggu "lanjut" sebelum Bagian 2 dikerjakan.

LANGKAH 2.2 - IMPLEMENTASI
A. Skema (aditif)
- device_groups: id, nama (unik per kolom lower), deskripsi, warna_garis (hanya
  biru | merah | abu), urutan, parent_id nullable (maksimal 2 tingkat: Wilayah > Area),
  created_at. Gunakan ulang topology_groups bila inventaris menyarankan; satu konsep,
  satu tabel.
- devices: kolom group_id nullable (FK, on delete set null). Kolom location lama
  TIDAK dihapus dan tidak diubah.
- Hubungkan grup peta ke grup perangkat (topology_groups.group_id) agar kotak area di
  peta mengikuti keanggotaan perangkat otomatis.
- Migrasi aman: tidak mengubah data lama. Tanpa grup, semua tampilan tetap seperti
  sekarang.

B. Menu dan halaman Grup
- Menu baru "Grup" (desktop: navigasi atas; mobile: "Lainnya" atau bar yang sudah ada).
- /grup: daftar grup/area dalam kartu atau tabel: nama, jumlah perangkat, ringkasan
  status ("8 dari 10 online"), insiden terbuka, status terburuk (teks + warna +
  glyph), uptime 24 Jam gabungan. Pencarian dan urutan.
- Tambah/ubah/hapus grup (admin), dengan validasi Zod dan pesan error spesifik
  ("Nama grup sudah dipakai"). Hapus grup: dialog menanyakan perangkat dilepas
  (tanpa grup) atau dipindah ke grup lain; tidak pernah menghapus perangkat.
- Penetapan perangkat ke grup, tiga cara:
  1. Di form perangkat: pilihan Grup (dropdown, boleh membuat grup baru langsung).
  2. Aksi massal di tabel Perangkat: centang beberapa perangkat > "Pindahkan ke
     grup" (satu request, atomik, tampilkan jumlah berhasil).
  3. Di halaman grup: panel "Tambah perangkat" berisi pencarian dan multi-pilih
     perangkat yang belum bergrup atau dari grup lain.
- "Buat grup dari Lokasi": pratinjau pengelompokan otomatis berdasarkan nilai
  location yang sama (normalisasi huruf besar/kecil, spasi, garis bawah), tampilkan
  daftar grup yang akan dibuat dan perangkat di dalamnya, lalu terapkan hanya setelah
  admin menekan Konfirmasi. Tidak mengubah kolom location.
- Halaman detail grup /grup/[id]: ringkasan (jumlah, online, log berhenti, offline,
  belum ada data), donut status kecil, daftar perangkat dengan status dan ping,
  insiden terbuka di seluruh anggota, grafik volume log gabungan 24 jam (dari
  agregasi per jam yang ada), riwayat status gabungan memakai rumus uptime yang sama
  (periode tanpa data tidak dihitung), dan tombol "Buka di peta" yang memfokuskan
  peta pada grup itu.

C. Integrasi (aditif, tanpa mengubah perilaku default)
- Tabel Perangkat: kolom/chip Grup, filter Grup, dan opsi "Kelompokkan berdasarkan
  grup" (bagian yang bisa dilipat dengan ringkasan status di judul bagian).
- Peta: kotak area otomatis menampung node anggota grup dengan label, hitungan
  "3 dari 5 online", dan warna garis tipis sesuai grup. Menggeser kotak grup
  menggeser seluruh node di dalamnya (simpan posisi sesuai aturan Bagian 1: terakhir
  menang per elemen). Node yang diseret keluar/masuk kotak menawarkan pindah grup
  dengan konfirmasi inline (bukan alert). Tombol lipat/buka grup: saat dilipat grup
  tampil sebagai satu node gabungan dengan status terburuk anggotanya dan lencana
  jumlah; klik membuka detail grup di drawer yang sudah ada (daftar anggota dan
  ringkasan). Garis yang menuju anggota grup yang dilipat digabung visual.
- Filter Grup juga ditambahkan sebagai parameter opsional di Event Log, Insiden,
  Ringkasan, dan heatmap (opsional, default semua). Pilihan tersimpan di URL.
- Widget "Per Area" di Ringkasan: daftar grup dengan bilah status ringkas
  (online/log berhenti/offline) dan jumlah insiden; klik memfilter. Pakai data
  ringkasan yang ada, bukan query per grup (satu query GROUP BY).
- Pembaruan langsung lewat SSE yang ada: perubahan status perangkat memperbarui
  ringkasan grupnya tanpa fetch penuh. Event baru kecil "grup.berubah" (id grup,
  versi) untuk perubahan keanggotaan/nama.
- Notifikasi (channel yang ada): opsional, bila channel/aturan mendukung filter
  perangkat, tambahkan pilihan "Semua perangkat di grup X". Jangan menambah logika
  pemicu baru dan jangan mengubah aturan yang berjalan.

D. Keamanan dan performa
- Hanya admin yang mengubah grup dan keanggotaan; viewer hanya melihat (diperiksa di
  server). Validasi Zod, CSRF, batas ukuran aksi massal (maks 200 perangkat).
- Ringkasan grup lewat satu query teragregasi dan cache Redis TTL 15-30 detik,
  di-invalidasi oleh event yang ada. Siapkan indeks pada devices.group_id.
- Tidak ada N+1. Target p95 daftar grup < 300 ms untuk 300 perangkat dan 30 grup.

E. UI
- Gaya dan komponen yang sudah ada, tanpa emoji. Status berlabel teks + glyph, tidak
  hanya warna. Empty state berguna: "Belum ada grup. Kelompokkan perangkat yang berada
  di area yang sama, atau buat otomatis dari kolom Lokasi."
- Mobile: daftar grup sebagai kartu, aksi massal lewat lembar bawah, peta mengikuti
  perilaku mobile yang ada (pengeditan grup di peta hanya di layar >= 768 px).
- Aksesibilitas: dialog dengan focus trap, label ARIA untuk bagian yang bisa dilipat,
  navigasi keyboard di daftar dan peta.

LANGKAH 2.3 - TES BAGIAN 2
- Regresi: tanpa grup, Perangkat, Peta, Ringkasan, Event Log, dan Insiden tampil dan
  berperilaku persis seperti sebelumnya (screenshot sebelum/sesudah). Respons endpoint
  lama identik. lint, typecheck, seluruh tes lama lulus.
- CRUD grup, validasi nama ganda, hapus grup dengan opsi lepas/pindah, perangkat
  tidak pernah ikut terhapus.
- Penetapan lewat form, aksi massal (50 perangkat sekaligus, atomik), dan halaman
  grup. Perangkat tidak bisa berada di dua grup. Batas 200 diuji.
- "Buat grup dari Lokasi": pratinjau benar untuk variasi penulisan (MAIN_BPI, main bpi,
  Main-BPI), tidak berubah sebelum konfirmasi, kolom location tetap utuh.
- Peta: kotak area, hitungan online, geser kotak menggeser anggota, pindah grup lewat
  seret dengan konfirmasi inline, lipat/buka grup, status gabungan terburuk benar, dan
  tidak ada konflik palsu dari Bagian 1.
- Status langsung: matikan satu perangkat uji -> ringkasan grup, kotak area, widget
  "Per Area", dan drawer berubah tanpa refresh dan tanpa mereset zoom.
- Filter Grup bekerja di Perangkat, Event Log, Insiden, Ringkasan; URL bisa dibagikan.
- Hak akses: viewer tidak bisa mengubah grup/keanggotaan (ditolak server).
- Performa: seed 300 perangkat dan 30 grup, p95 dan jumlah query tercatat, tidak ada
  fetch ganda. Mobile 360/390/768 rapi. Tampilkan screenshot semua tampilan baru.

LAPORAN AKHIR (wajib)
- Akar masalah bug dan cara perbaikannya, daftar file yang diubah/ditambah, migrasi
  yang dibuat, dan konfirmasi tertulis bahwa fitur dan endpoint lain tidak berubah.
- Keterbatasan yang diketahui.