TAMBAHAN BERDASARKAN SCREENSHOT (prioritaskan saat diagnosis)

Gejala di halaman /peta (admin, desktop):
- Toolbar, filter, tombol Peta/Daftar, kontrol zoom, legenda, dan minimap tampil,
  tetapi kanvas KOSONG.
- TIDAK ada empty state ("Belum ada perangkat di peta...") dan TIDAK ada pesan error.
- Minimap hanya kotak abu-abu polos tanpa titik node.
- Kontrol zoom hanya tombol + dan -, tidak ada tombol Pusatkan/Fit.
- Semua filter bernilai "Semua ...".
Artinya data peta dianggap ada, tetapi node tidak tergambar atau berada di luar
jangkauan, dan kegagalannya tidak dilaporkan.

Tambahkan ke Langkah 1 (diagnosis):
1. Bandingkan jumlah node/grup dari /api/peta dengan jumlah node yang masuk ke React
   Flow dan yang benar-benar dirender. Tampilkan hitungan per tahap: dari API ->
   setelah transformasi -> setelah filter -> setelah hidden -> terrender.
2. Cetak hidden, posisi, ukuran, dan parentId untuk semua node dan grup, serta nilai
   viewport saat ini (x, y, zoom) dan batas minimap. Cek apakah SEMUA node berstatus
   hidden (mis. semua grup dianggap terlipat) dan apakah node ringkasan grup terlipat
   benar-benar dirender.
3. Cek apakah kondisi "peta kosong" memakai data mentah atau hasil render, sehingga
   empty state tidak tampil padahal tidak ada node yang terlihat.
4. Cek mengapa tidak ada pesan error: apakah error di-catch tanpa ditampilkan.

Tambahkan ke Langkah 2 (perbaikan):
a. Kondisi "tidak ada node terlihat" harus ditangani eksplisit. Bila jumlah node
   terrender = 0 padahal data punya node, tampilkan banner di atas kanvas dengan
   pesan spesifik: "Peta berisi N perangkat tetapi tidak ada yang tampil. Pusatkan
   peta, atau atur ulang tampilan grup." dengan tombol "Pusatkan" dan "Reset tampilan
   grup". Bila node memang 0, tampilkan empty state yang sudah ada.
b. Tambahkan tombol "Pusatkan" (fit view) pada kontrol zoom (di samping + dan -),
   dan panggil fitView otomatis setelah peta dimuat, setelah lipat/buka, setelah
   Rapikan, dan bila tidak ada node di dalam viewport. Minimap harus memakai data
   node yang sama dengan kanvas.
c. Jangan pernah menyembunyikan seluruh node karena status lipat: minimal satu node
   ringkasan per grup terlipat harus tampil, dan perangkat tanpa grup selalu tampil.
   Bila status lipat membuat tidak ada yang tampil, abaikan status itu, kembali ke
   semua terbuka, dan tulis ulang status yang bersih.
d. Pastikan error render dan error pemuatan data selalu tampil lewat error boundary
   dan banner (tidak ditelan), dengan detail di log.

Tambahkan ke Langkah 3 (tes):
- Skenario: semua grup berstatus terlipat, semua node hidden, koordinat NaN pada satu
  node, viewport di luar jangkauan, dan respons API valid tetapi transformasi
  menghasilkan 0 node. Pada semua skenario: banner/pesan tampil, tombol Pusatkan
  memulihkan peta, dan peta tidak kosong tanpa penjelasan.
- Tampilkan screenshot kanvas sebelum dan sesudah perbaikan.
