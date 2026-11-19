TUGAS: Perbaiki validasi rentang Kustom pada kartu "Ketersediaan & Riwayat Status".
Hanya perbaiki yang disebut di sini. Jangan ubah desain atau fitur lain.

MASALAH
1. Memilih tanggal "dari" dan "sampai" yang sama (misalnya 05/11/2026 s/d 05/11/2026)
   menghasilkan error "dari < sampai", padahal itu cara wajar melihat satu hari.
2. Saat error validasi muncul, bar, subjudul, dan angka ringkasan masih menampilkan
   data lama sehingga tampak seolah hasil rentang yang dipilih.
3. Pesan error terlalu teknis dan tombol "Muat Ulang" tidak relevan untuk error
   validasi.

PERBAIKAN
A. Interpretasi tanggal (zona Asia/Jakarta)
- "dari" = awal hari 00:00:00 WIB, "sampai" = akhir hari 23:59:59 WIB (inklusif).
  Jadi 5 Nov s/d 5 Nov = satu hari penuh. "Sampai" yang melewati waktu sekarang
  otomatis dipotong ke sekarang.
- Validasi di UI sebelum request: tombol "Terapkan" nonaktif bila tanggal kosong,
  "dari" > "sampai", atau rentang > 400 hari. Pemilih tanggal membatasi min/max
  (tidak bisa memilih tanggal masa depan atau sebelum perangkat dibuat).
- Validasi server tetap ada, memakai aturan yang sama (dari <= sampai setelah
  normalisasi hari).

B. Pesan error yang jelas dan spesifik
- Tanggal akhir lebih awal dari awal: "Tanggal akhir harus sama dengan atau setelah
  tanggal awal."
- Lebih dari 400 hari: "Rentang maksimal 400 hari. Persempit pilihan tanggalnya."
- Tanggal kosong: "Pilih tanggal awal dan akhir."
- Tampilkan pesan di bawah kontrol tanggal (inline), bukan menggantikan area bar.
  Untuk error validasi tidak ada tombol "Muat Ulang". Tombol itu hanya untuk
  kegagalan jaringan/server.

C. Konsistensi tampilan saat error
- Bila request gagal atau validasi tidak lolos, JANGAN menampilkan data lama
  sebagai hasil rentang baru. Pilihan: kembalikan kontrol ke pilihan valid terakhir
  beserta datanya (subjudul, bar, ringkasan semuanya dari pilihan itu), atau
  kosongkan bar dengan keterangan "Belum ada rentang valid".
- Subjudul, label kiri/kanan bar, dan ringkasan harus selalu berasal dari data
  yang sama dengan bar yang tampil.
- Skala otomatis menyesuaikan rentang kustom (1 hari -> 15 menit atau 1 jam),
  dan dropdown menampilkan nilai yang benar-benar dipakai, bukan nilai lama.

D. Angka ringkasan
- "Total Gangguan 0 kali" tidak boleh menampilkan "1 detik" di bawahnya. Tampilkan
  durasi total hanya bila jumlah gangguan > 0, selain itu "Tidak ada gangguan".
- Bila seluruh rentang tanpa data, uptime tampil "-" dengan keterangan cakupan,
  bukan 100%.

TES
- 05/11 s/d 05/11 -> valid, satu hari penuh, jumlah slot sesuai skala.
- 06/11 s/d 05/11 -> pesan "Tanggal akhir harus sama dengan atau setelah tanggal awal",
  tombol Terapkan nonaktif, tampilan tetap konsisten.
- Rentang 401 hari -> pesan batas 400 hari.
- Server mati saat memuat -> muncul pesan gagal + "Muat Ulang", data lama tidak
  ditampilkan sebagai hasil baru.
- Ringkasan dan bar selalu cocok dengan subjudul. Tampilkan screenshot tiap kasus.
- Jalankan lint, typecheck, dan seluruh tes.