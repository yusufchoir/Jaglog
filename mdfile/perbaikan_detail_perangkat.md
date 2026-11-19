TUGAS: Detail perangkat masih gagal dimuat. Halaman /perangkat/dc169921-54f2-464e-9dd1-
006eb9d8c261 menampilkan "Gagal Memuat Data Perangkat - Gagal memuat statistik perangkat"
dengan ID Referensi ERR-DEVSTATS-MWGD24Z6-TA4AJ. Console: GET
/api/devices/dc169921-54f2-464e-9dd1-006eb9d8c261/stats -> 500 (Internal Server Error),
dikirim 2 kali (awal + 1 percobaan ulang). Sebelumnya endpoint lain di halaman yang sama
juga 500: /api/devices/04c4beb0-0ea9-4586-97ef-9272a2f4f337/riwayat-status?rentang=7h&
skala=otomatis. Perbaikan sisi klien sudah berhasil (tidak ada React #300, tidak ada
500 pada /api/client-error, retry terbatas, pesan error benar). Sisa masalah ada di SERVER.
Peringatan Chrome "beforeinstallpromptevent.preventDefault() called ... must call prompt()"
juga masih muncul. Hanya perbaiki hal-hal ini.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint yang
  tidak terkait. Respons endpoint lama tidak berubah (hanya aditif). Tema dan gaya tetap
  (terang, garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia).
- Berbasis bukti: tunjukkan stack trace server, SQL yang gagal, atau nilai konfigurasi untuk
  setiap kesimpulan. Reproduksi di build production dengan database yang sama dengan yang
  saya pakai. Jangan menebak.
- Keamanan tidak dilonggarkan: otorisasi server fail-closed, tanpa data sensitif di pesan
  error ke pengguna.
- Backup (pg_dump) sebelum mengubah data atau skema. Migrasi aditif dan idempoten, indeks
  dengan CREATE INDEX CONCURRENTLY, tidak menghapus data tanpa persetujuan saya. Tidak ada
  tabel/worker/job duplikat, tidak ada fetch ganda, tidak ada alert/confirm bawaan browser.
- Jika sebuah optimasi sebelumnya terbukti penyebab dan tidak bisa diperbaiki cepat, matikan
  lewat feature flag dan laporkan.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode atau data dulu)
1. Ambil log server dan stack trace lengkap untuk request /api/devices/{id}/stats pada
   perangkat dc169921-54f2-464e-9dd1-006eb9d8c261. Cari juga ID referensi
   ERR-DEVSTATS-MWGD24Z6-TA4AJ di log server dan di tabel client_errors (bila ada). Tampilkan
   pesan error, file:baris, dan SQL yang gagal beserta pesan databasenya.
2. Periksa kandidat penyebab dan laporkan mana yang terbukti:
   a. Tabel/kolom yang dirujuk kode tetapi tidak ada di database production (agregasi log per
      jam, riwayat status, agregasi ping, status tampilan, dan lainnya). Daftar migrasi yang
      sudah/belum berjalan; apakah entrypoint menjalankan migrasi otomatis saat start;
      bandingkan skema database dengan skema di kode.
   b. Serialisasi: nilai BigInt, Decimal/numeric, atau Date dari Postgres yang membuat
      JSON.stringify/NextResponse.json gagal ("Do not know how to serialize a BigInt").
   c. Pembagian nol, null/undefined tak tertangani, atau array kosong pada perangkat tertentu
      (tanpa ping, tanpa log, nonaktif, baru dibuat).
   d. Validasi Zod di server yang menolak data sendiri.
   e. Timeout (statement_timeout, kunci cache, Redis) atau kegagalan Redis yang melempar
      error alih-alih memakai jalur cadangan.
   f. Helper bersama yang dipakai endpoint stats dan riwayat-status (fungsi ringkasan,
      koneksi, pencarian pengguna/peran).
3. Uji endpoint stats DAN riwayat-status (semua rentang dan skala Otomatis) untuk SEMUA 13
   perangkat. Tampilkan tabel: perangkat | stats | riwayat-status | penyebab bila gagal. Catat
   apakah kegagalan hanya pada perangkat tertentu atau umum.
4. Daftar SEMUA endpoint yang dipanggil halaman detail perangkat (header, ringkasan, stats,
   riwayat status, ping, pengiriman log, Event Log, insiden, analisa AI) dan status tiap
   endpoint untuk perangkat ini.
5. Peringatan install prompt: tunjukkan kode yang menangani beforeinstallprompt (apakah
   event disimpan, dan apakah tombol "Pasang aplikasi" memanggil event.prompt()).
Laporkan akar masalah dengan bukti. Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN (sesuai bukti Langkah 1)
A. Perbaiki akar masalah yang terbukti. Jika skema belum sesuai: jalankan migrasi yang
   belum berjalan di production dengan aman (backup, idempoten), pastikan entrypoint
   menjalankannya otomatis, dan buat healthcheck GAGAL bila skema tidak sesuai kode. Jika
   agregasi kosong/parsial: backfill bertahap (batch kecil, jeda antar batch, dapat
   dilanjutkan, tanpa mengunci tabel) dengan indikator progres; sebelum lengkap, baca dari
   jalur lama atau tampilkan "Sedang menyiapkan data", BUKAN angka 0 palsu.
B. Serialisasi aman: konversi BigInt/Decimal/Date dari database ke angka/teks di satu
   fungsi pembantu terpusat yang dipakai semua endpoint (bukan perbaikan di satu tempat saja).
C. Endpoint stats dan riwayat-status tangguh:
   - Perangkat tanpa data mengembalikan 200 dengan keadaan "Belum Ada Data" dan nilai "-",
     bukan 500. Tangani pembagian nol, null, dan array kosong.
   - Setiap bagian respons dihitung terpisah (status per bagian: ok | gagal | tanpa_data)
     sehingga satu bagian gagal tidak membatalkan bagian lain.
   - Kegagalan Redis/cache tidak boleh menggagalkan request (jalur cadangan tanpa cache).
   - Kesalahan tak terduga: respons terstruktur (kode, pesan aman, id referensi) dan dicatat
     di log server dengan stack lengkap. ID referensi yang tampil di UI harus sama dengan
     yang tercatat di log server agar mudah dicari.
D. Halaman detail perangkat: header (nama, IP, status) tetap tampil walau stats gagal; tiap
   bagian punya boundary dan status error sendiri dengan Coba Lagi. "Perangkat tidak
   ditemukan" hanya untuk 404 sungguhan.
E. Install prompt PWA: simpan event beforeinstallprompt di ref; bila ditahan (preventDefault),
   tampilkan tombol "Pasang aplikasi" di menu "Lainnya" yang memanggil event.prompt() saat
   diklik lalu membersihkan event. Bila tidak ada UI sendiri, jangan memanggil preventDefault.
   Sembunyikan tombol setelah terpasang atau ditolak (ingat 30 hari). Tanpa mengubah perilaku
   PWA lain.
F. Pencegahan: tes endpoint stats dan riwayat-status untuk semua tipe data (perangkat baru,
   tanpa log, tanpa ping, nonaktif, banyak data, nilai besar yang menghasilkan BigInt);
   pemeriksaan skema-vs-kode saat start; `npm run check:data` memeriksa tabel/kolom yang
   dirujuk kode ada di database; tampilkan status migrasi dan kelengkapan agregasi di
   /pengaturan > "Kesehatan sistem" (admin saja).

LANGKAH 3 - TES (build production, data nyata)
- Detail perangkat untuk SEMUA 13 perangkat, semua tab, semua rentang dan skala Otomatis:
  tidak ada 500, Console bersih, data tampil benar (bandingkan dengan query langsung ke
  database dan Event Log).
- Simulasi: tabel agregasi kosong, perangkat tanpa data, nilai BigInt besar, Redis mati, satu
  query timeout, satu bagian dipaksa gagal. Hasil: tidak ada 500 tak terjelaskan, tidak ada
  "0" palsu, bagian lain tetap tampil, pesan spesifik dengan Coba Lagi, permintaan berhenti
  sesuai batas retry.
- ID referensi di UI cocok dengan entri di log server.
- Setelah restart/deploy: migrasi otomatis berjalan, healthcheck benar.
- Tombol "Pasang aplikasi" memunculkan dialog; peringatan Chrome hilang.
- Tampilan mobile (lebar 469 px seperti di screenshot dan 390 px) rapi.
- Regresi: semua fitur lain tampil dan berperilaku sama, respons endpoint lama identik, lint,
  typecheck, seluruh tes lama lulus. Tambahkan tes regresi untuk poin di atas.

LAPORAN AKHIR (wajib)
- Akar masalah dengan bukti, apa yang diperbaiki atau dimatikan, daftar file/migrasi, hasil
  backfill dan check:data, lokasi backup, konfirmasi tertulis bahwa fitur lain tidak berubah,
  dan sisa risiko.