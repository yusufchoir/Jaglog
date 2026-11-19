TUGAS: Perbaiki pemilihan skala "Otomatis" pada kartu "Ketersediaan & Riwayat Status"
(rentang Kustom). Hanya perbaiki yang disebut di sini.

MASALAH
Rentang kustom 04/11/2026 s/d 05/11/2026 (dipotong sampai waktu sekarang, sekitar 44 jam)
dengan skala Otomatis menghasilkan error: "Jumlah slot (11) tidak memenuhi syarat
(harus antara 12 dan 96). Silakan pilih skala lain."
Skala otomatis memilih skala 4 jam (44 jam / 4 = 11 slot) yang melanggar batas
minimum yang ditentukan sendiri. Dengan skala manual 30 menit atau 1 jam, tampilan normal.

PERBAIKAN
1. Fungsi pemilih skala otomatis (satu fungsi terpusat, dipakai UI dan server)
   - Hitung durasi efektif: dari = awal hari "dari" (00:00 WIB), sampai = min(akhir
     hari "sampai", sekarang).
   - Untuk setiap skala kandidat yang diizinkan untuk jenis rentang itu (15m, 30m,
     1j, 4j, 6j, 1h, 1m, 1b), hitung jumlah slot memakai rumus yang SAMA dengan yang
     dipakai validasi server, yaitu jumlah slot yang benar-benar dibentuk (termasuk
     slot pertama/terakhir yang sebagian), bukan durasi/skala dibulatkan.
   - Ambil hanya kandidat dengan 12 <= jumlah slot <= 96. Dari situ pilih yang
     jumlah slotnya paling dekat dengan 48. Bila seri, pilih skala yang lebih halus.
   - Jika tidak ada kandidat yang valid (rentang sangat pendek, misalnya < 3 jam),
     pakai skala terhalus (15 menit) dan izinkan jumlah slot di bawah 12.
     Batas minimum 12 hanya berlaku sebagai syarat memilih skala otomatis, bukan
     alasan menolak rentang. Batas maksimum 96 tetap keras.
   - Otomatis TIDAK BOLEH menghasilkan error jumlah slot. Bila terjadi, itu bug.

2. Konsistensi UI dan server
   - Server menerima skala=otomatis dan memakai fungsi yang sama, lalu mengembalikan
     skala_terpilih di respons. UI menampilkan "Otomatis (1 jam)" dan subjudul
     "44 slot waktu (interval 1 jam) ...". Hilangkan label "Otomatis (Otomatis)".
   - Dropdown hanya menampilkan skala dengan 12-96 slot untuk rentang yang dipilih,
     dihitung dengan fungsi yang sama.
   - Saat rentang atau tanggal berubah, bila skala manual yang dipilih menjadi tidak
     valid, kembalikan ke Otomatis dengan toast singkat:
     "Skala disesuaikan ke Otomatis karena rentang berubah."

3. Pesan error
   - Error validasi (jumlah slot, tanggal) tampil inline tanpa tombol "Muat Ulang".
     Tombol itu hanya untuk gagal jaringan/server.
   - Bila masih ada error slot untuk skala manual, pesan harus menyebut pilihan yang
     valid: "Skala 15 menit menghasilkan 176 slot (maks 96). Pilih 30 menit atau 1 jam."

TES (unit test fungsi pemilih skala + tes endpoint)
- 04/11 s/d 05/11 pada pukul 20.00 WIB (44 jam): Otomatis -> 1 jam (44 slot), tanpa error.
- 05/11 s/d 05/11 (satu hari): Otomatis -> 30 menit (48 slot) atau 15 menit sesuai
  aturan terdekat ke 48.
- Rentang 2 jam: Otomatis -> 15 menit, boleh kurang dari 12 slot, tanpa error.
- Rentang 400 hari: Otomatis memilih skala valid (minggu), tidak error.
- Jam sekarang berbeda-beda (00.30, 12.00, 23.59): jumlah slot Otomatis selalu valid.
- Skala manual yang tidak valid ditolak dengan pesan yang menyebut pilihan valid.
- Tampilkan screenshot rentang 1 hari, 2 hari, 2 jam, dan 30 hari.
- Jalankan lint, typecheck, dan seluruh tes.