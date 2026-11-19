TUGAS: Perbaiki error yang terlihat di Console browser (production) pada halaman Dashboard
dan Detail Perangkat. Bukti dari log:

1. Minified React error #300 ("Rendered fewer hooks than expected" - ada hook yang
   dilewati karena return lebih awal) ditangkap oleh
   [SectionErrorBoundary:Grafik Aktivitas Log]. Akibatnya dashboard menampilkan
   "Gagal Memuat Grafik Aktivitas Log".
2. POST /api/client-error -> 500 (endpoint pelaporan error ikut gagal).
3. GET /api/devices/dc169921-54f2-464e-9dd1-006eb9d8c261/stats -> 500, dan sebelumnya
   GET /api/devices/04c4beb0-0ea9-4586-97ef-9272a2f4f337/riwayat-status?rentang=7h
   &skala=otomatis -> 500 (berulang). Detail perangkat menampilkan "Gagal memuat
   statistik perangkat" dan "Perangkat tidak ditemukan".
4. Peringatan Chrome: "Banner not shown: beforeinstallpromptevent.preventDefault()
   called. The page must call beforeinstallpromptevent.prompt()".
Catatan: ratusan baris stack berulang (aY/a9) adalah rekursi normal React pada pohon
komponen yang dalam, bukan loop tak terbatas; jangan dikejar.
Hanya perbaiki hal di atas.

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint yang
  tidak terkait. Respons endpoint lama tidak berubah (hanya aditif). Tema dan gaya tetap
  (terang, garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia yang
  spesifik).
- Berbasis bukti: tunjukkan pesan error server, stack trace, hasil query, atau nilai
  konfigurasi untuk setiap kesimpulan. Reproduksi di build production dengan database
  yang sama dengan yang saya pakai.
- Keamanan tidak dilonggarkan: otorisasi server fail-closed, tanpa data sensitif di pesan
  error ke pengguna.
- Backup (pg_dump) sebelum mengubah data atau skema. Migrasi aditif dan idempoten,
  indeks dengan CREATE INDEX CONCURRENTLY, tidak menghapus data tanpa persetujuan saya.
  Tidak ada tabel/worker/job duplikat, tidak ada fetch ganda, tidak ada alert/confirm
  bawaan browser.
- Jika sebuah optimasi sebelumnya terbukti penyebab dan tidak bisa diperbaiki cepat,
  matikan lewat feature flag dan laporkan.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode atau data dulu)

A. React error #300 pada Grafik Aktivitas Log
 1. Jalankan komponen yang sama pada build NON-minified (development atau build dengan
    source map) dan tangkap pesan lengkap serta nama komponen. Tunjukkan file:baris
    dari hook yang dilewati: return/throw/if lebih awal SEBELUM useMemo, useState,
    useEffect, useCallback, useRef, atau hook kustom (mis. useQuery) pada komponen grafik
    dan anak-anaknya.
 2. Tentukan kondisi apa yang menghasilkan jumlah hook berbeda antar render (loading ->
    data, error -> sukses, data kosong -> berisi, mode "Semua" -> "Per tingkat
    keparahan", jam parsial, perubahan tampilan tabel).
 3. Periksa semua komponen lain dengan pola yang sama: heatmap, donut status, donut
    alarm, Status Per Area, kartu perangkat, drawer detail, peta, riwayat status,
    Event Log, widget NOC. Daftar semua pelanggaran aturan hooks (jalankan
    eslint-plugin-react-hooks rules-of-hooks pada seluruh kode; laporkan hasilnya).
 4. Apakah ada pemanggilan hook di dalam kondisi, loop, fungsi bersarang, atau setelah
    return, dan apakah ada komponen yang dibungkus React.memo/dynamic import yang
    mengubah urutan hook.

B. Error 500 (stats, riwayat-status, client-error)
 1. Untuk SETIAP endpoint yang gagal, ambil isi respons dan stack trace server, serta SQL
    yang gagal beserta pesan database (mis. relation/column does not exist, tipe data,
    pembagian nol, null tak tertangani, validasi Zod di server, timeout).
 2. Bandingkan skema database production dengan skema di kode: daftar tabel dan kolom
    yang dirujuk kode tetapi tidak ada di database (client_errors, tabel agregasi log per
    jam, riwayat status, agregasi ping, status tampilan, dan lainnya). Tampilkan riwayat
    migrasi yang sudah/belum berjalan dan apakah entrypoint menjalankan migrasi otomatis
    saat start.
 3. Apakah ketiga endpoint memakai helper/fungsi yang sama yang gagal (mis. fungsi
    ringkasan, koneksi, pencarian pengguna/peran, cache Redis).
 4. Uji SEMUA 13 perangkat pada endpoint stats dan riwayat-status; tampilkan mana yang
    gagal dan mana yang berhasil, beserta perbedaannya (data kosong, perangkat tanpa ping,
    perangkat tanpa log, perangkat nonaktif).
 5. Mengapa 500 ditampilkan sebagai "Perangkat tidak ditemukan" (file:baris pemetaan error).
 6. Mengapa permintaan yang sama berulang (konfigurasi retry/refetch).

C. Peringatan install prompt
 - Tunjukkan kode yang menangani beforeinstallprompt: apakah event disimpan, dan apakah
   tombol "Pasang aplikasi" memanggil event.prompt().

Laporkan akar masalah tiap butir dengan bukti. Berhenti dan tunggu "lanjut".

LANGKAH 2 - PERBAIKAN

A. Grafik dan aturan hooks
 - Semua hook dipanggil di bagian ATAS komponen, selalu dalam urutan dan jumlah yang sama
   pada setiap render, sebelum return/kondisi apa pun. Logika kondisional dipindah ke
   DALAM hook (mis. useMemo yang mengembalikan nilai aman) atau komponen dipecah menjadi
   komponen terpisah per keadaan (Memuat, Gagal, Kosong, Berisi) sehingga setiap komponen
   memiliki urutan hook yang tetap.
 - Terapkan perbaikan yang sama pada SEMUA pelanggaran yang ditemukan di Langkah 1A.3.
 - Aktifkan eslint-plugin-react-hooks sebagai ERROR (rules-of-hooks) dan warning untuk
   exhaustive-deps pada seluruh kode klien; lint harus gagal bila ada pelanggaran baru
   (masuk ke skrip lint dan pemeriksaan sebelum build).
 - Normalisasi data grafik sebelum render (angka dari string, NaN/Infinity ditangani,
   null -> "-", array kosong -> keadaan kosong yang benar) dan validasi bentuk dengan Zod;
   entri tidak valid dibuang dan dicatat, bukan membuat render gagal.
 - Error boundary grafik membedakan: gagal memuat (fetch) dengan "Coba Lagi", gagal
   menampilkan (render) dengan kode referensi, dan "Belum ada log pada 24 jam terakhir"
   HANYA bila pengecekan sukses dan nilainya benar-benar nol.

B. Skema dan endpoint 500
 - Jalankan/perbaiki migrasi yang belum berjalan di database production dengan aman
   (backup dulu, idempoten). Pastikan entrypoint menjalankan migrasi otomatis saat start
   dan healthcheck GAGAL bila skema tidak sesuai kode (aplikasi tidak melayani halaman
   dengan skema salah).
 - Tabel agregasi kosong atau belum lengkap: backfill bertahap dari data mentah (batch
   kecil, jeda antar batch, dapat dilanjutkan, tanpa mengunci tabel) dengan indikator
   progres; sebelum lengkap, baca dari jalur lama atau tampilkan "Sedang menyiapkan data",
   BUKAN angka 0 palsu.
 - Endpoint stats dan riwayat-status: perangkat tanpa data harus mengembalikan 200 dengan
   keadaan "Belum Ada Data" dan ringkasan "-", bukan 500. Setiap bagian respons dihitung
   terpisah (status per bagian: ok | gagal | tanpa_data) sehingga satu bagian gagal tidak
   membatalkan bagian lain. Kesalahan tak terduga menghasilkan respons terstruktur
   (kode, pesan aman, id referensi) dan dicatat di log server dengan stack.
 - Perbaiki akar masalah lain yang terbukti pada Langkah 1B.
 - Halaman detail perangkat: "Perangkat tidak ditemukan" HANYA untuk 404 sungguhan. 5xx/
   timeout menampilkan "Gagal memuat data perangkat" dengan Coba Lagi dan id referensi.
   Header perangkat tetap tampil bila hanya statistik yang gagal; tiap bagian detail
   punya boundary dan status error sendiri.

C. Endpoint /api/client-error tidak boleh gagal
 - Pastikan tabel client_errors ada (migrasi). Endpoint membungkus penulisan database
   dengan try/catch: bila gagal, catat di log server dan tetap kembalikan 204/202; tidak
   pernah 500 ke klien.
 - Pelapor di klien: tidak melempar error, tidak retry otomatis, dedupe error identik
   (60 detik), batas laju (maks 20/menit), dan tidak pernah memicu render ulang atau
   memuat ulang halaman. Payload tanpa token, cookie, atau data sensitif.

D. Batas retry untuk semua pemanggil
 - Satu konfigurasi retry terpusat: maksimal 2 kali dengan backoff dan jitter, 4xx tidak
   di-retry, circuit breaker (3 kegagalan -> 30 detik) berlaku untuk SEMUA endpoint
   (termasuk riwayat-status dan stats) dengan pesan yang menyebut alasan dan tombol Coba
   Lagi manual.

E. Install prompt PWA
 - Simpan event beforeinstallprompt di ref. Bila event ditahan (preventDefault), tampilkan
   tombol "Pasang aplikasi" di menu "Lainnya" yang memanggil event.prompt() saat diklik,
   lalu bersihkan event. Bila tidak ada UI pemasangan sendiri, jangan memanggil
   preventDefault. Sembunyikan tombol setelah terpasang atau ditolak (ingat 30 hari).
   Perubahan ini tidak boleh mengubah perilaku PWA lain.

F. Pencegahan
 - Tes otomatis: render komponen grafik dan komponen dashboard lain dengan urutan keadaan
   memuat -> error -> data -> kosong -> data lagi tanpa error hooks; tes endpoint stats/
   riwayat-status/client-error pada database kosong dan skema lengkap; pemeriksaan
   skema-vs-kode saat start; skrip `npm run check:data` memeriksa tabel/kolom yang
   dirujuk kode ada di database.
 - Tampilkan status migrasi dan kelengkapan agregasi di /pengaturan > "Kesehatan sistem"
   (admin saja).

LANGKAH 3 - TES (build production, data nyata)
 - Buka Dashboard, Detail Perangkat (SEMUA 13 perangkat, semua tab, semua rentang dan
   skala Otomatis), Peta, Event Log, Grup: Console bersih dari error React #300 dan dari
   500; tidak ada "Perangkat tidak ditemukan" yang salah.
 - Grafik: tampil benar pada urutan keadaan memuat -> error -> data -> kosong -> data,
   mode "Semua" dan "Per tingkat keparahan", dan saat refetch/pembaruan langsung.
   Angka grafik sama dengan Event Log dan tabel agregasi.
 - Simulasi: tabel agregasi kosong, tabel client_errors hilang, satu query gagal, respons
   dengan field null/string tak terduga, Redis mati. Hasil: tidak ada 500 tak terjelaskan,
   tidak ada hooks error, tidak ada "0" palsu, bagian lain tetap tampil, jumlah request
   berhenti sesuai batas retry (tampilkan log request).
 - /api/client-error mengembalikan 204/202 walau database gagal; tidak ada lonjakan
   laporan error ke server.
 - Setelah restart/deploy: migrasi otomatis berjalan, healthcheck benar.
 - Tombol "Pasang aplikasi" memunculkan dialog pemasangan; peringatan Chrome hilang.
 - eslint rules-of-hooks aktif dan lulus untuk seluruh kode.
 - Regresi: semua fitur lain tampil dan berperilaku sama (screenshot 1440 px dan 390 px),
   peran/navigasi konsisten, respons endpoint lama identik, lint, typecheck, seluruh tes
   lama lulus. Tambahkan tes regresi untuk poin-poin di atas.

LAPORAN AKHIR (wajib)
 - Akar masalah tiap error dengan bukti, apa yang diperbaiki atau dimatikan, daftar
   file/migrasi yang diubah, hasil backfill dan check:data, lokasi backup, konfirmasi
   tertulis bahwa fitur lain tidak berubah, dan sisa risiko.