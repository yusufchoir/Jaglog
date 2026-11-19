TUGAS: Buat tampilan JagaLog selalu menampilkan data terbaru TANPA refresh halaman,
dengan hanya mengambil data yang berubah. Ini penambahan lapisan "pembaruan langsung".

ATURAN KERAS (wajib dipatuhi)
- Jangan mengubah tampilan, tema, tata letak, teks, perhitungan, aturan deteksi,
  parser, atau fitur apa pun yang sudah ada. Hanya menambah mekanisme pembaruan.
- Jangan mengubah bentuk respons endpoint yang sudah ada (nama field, tipe, nilai).
  Penambahan harus aditif (parameter opsional atau endpoint delta baru yang kecil).
- Jangan ada fetch ganda: satu sumber data per tampilan, dedupe, tanpa polling tumpang
  tindih. Jangan membuat tabel, worker, atau job duplikat.
- Pembaruan tidak boleh mengganggu pengguna: scroll tidak melompat, modal/detail baris
  yang terbuka tidak tertutup, isian form dan filter tidak ter-reset, teks yang sedang
  diketik tidak hilang, tooltip tidak berkedip.
- Tidak ada data sensitif di event: tidak ada token, password, isi raw log, atau
  rahasia channel. Event hanya berisi id, jenis, versi, dan hitungan kecil.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan dengan file:baris:
a. Semua halaman/tab dan komponen yang menampilkan data berubah: Ringkasan (kartu
   perangkat, angka, grafik, insiden terbaru), /perangkat (tabel + status), detail
   perangkat (header status/ping, tab Ringkasan, Event Log, Insiden, Analisa AI,
   riwayat status dan dua baris ping/log), /insiden, /pengaturan (status disk jika ada).
b. Cara tiap halaman mengambil data sekarang (server component, TanStack Query/SWR,
   polling, mode Live di Event Log), interval, dan endpoint yang dipakai.
c. Library data-fetching di klien dan kunci cache yang ada.
d. Apakah Redis pub/sub sudah dipakai (invalidasi cache collector), dan konfigurasi
   koneksi Redis (agar koneksi subscriber tidak mengganggu BullMQ).
e. Titik di worker/collector tempat data berubah: ingest log (setelah commit batch),
   status perangkat dan ping, insiden dibuat/diubah, analisa AI selesai, ringkasan per
   jam diperbarui, perangkat diubah/dinonaktifkan, token dibuat ulang.
f. Cara autentikasi sesi dan role (admin/viewer), dan apakah viewer boleh melihat
   semua perangkat.
g. Konfigurasi proxy (Traefik di Coolify) dan apakah ada kompresi/buffering yang bisa
   merusak streaming.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Penerbit event (di sisi server/worker, PADA titik yang ditemukan di inventaris)
- Fungsi tunggal publishChange(event) yang menerbitkan ke kanal Redis pub/sub
  "jagalog:changes". Dipanggil SETELAH data berhasil di-commit ke database, tidak
  sebelumnya.
- Bentuk event (kecil, < 500 byte):
  { id, tipe, perangkat_id, versi, waktu, data_ringkas }
  Tipe awal: "log.baru" (data_ringkas: id_log_terakhir, jumlah), "perangkat.status",
  "perangkat.ping", "perangkat.diubah", "insiden.berubah" (id_insiden, status),
  "analisa.selesai", "statistik.diperbarui" (rentang jam yang berubah),
  "pengiriman_log.berubah".
- Coalescing (wajib): jangan menerbitkan satu event per pesan log. Kelompokkan per
  (perangkat, tipe) dalam jendela 1-2 detik, kirim satu event dengan jumlah dan id
  terakhir. Lonjakan 3000 pesan/detik harus tetap menghasilkan paling banyak 1 event
  "log.baru" per perangkat per detik.
- Gagal menerbitkan tidak boleh mengganggu pipeline ingest, worker, atau deteksi
  (tangkap error, catat, lanjut).

B. Endpoint stream SSE: GET /api/stream
- Route handler dengan runtime Node.js, dynamic (tidak di-cache), header:
  Content-Type text/event-stream, Cache-Control no-cache, no-transform,
  Connection keep-alive, X-Accel-Buffering no. Tanpa kompresi.
- Autentikasi memakai sesi cookie yang sudah ada. Tanpa sesi valid -> 401.
  Otorisasi sama dengan halaman: hanya event untuk perangkat yang boleh dilihat
  pengguna itu.
- Satu koneksi subscriber Redis BERSAMA per proses app (bukan satu per klien),
  yang menyebarkan event ke klien yang terhubung. Gunakan koneksi Redis terpisah
  dari koneksi BullMQ dan cache.
- Klien menyatakan perangkat dan tipe yang sedang ia tampilkan (parameter
  ?perangkat=...&topik=...), dan server hanya mengirim event yang relevan. Topik bisa
  diperbarui tanpa memutus koneksi.
- Heartbeat komentar ": ping" setiap 20 detik agar koneksi tidak diputus proxy.
- Dukungan Last-Event-ID: simpan 60 detik terakhir event di Redis (stream atau list
  ber-TTL, panjang terbatas) supaya klien yang terputus sebentar menerima event yang
  terlewat; bila terlalu lama terputus, kirim event "resync" yang membuat klien
  mengambil ulang data tampilan yang aktif saja.
- Batas: maksimal 5 koneksi per pengguna dan 200 koneksi per instance; koneksi lama
  ditutup rapi. Tutup koneksi saat sesi berakhir atau pengguna logout.
- Bersihkan listener saat klien putus (tidak boleh ada kebocoran memori).

C. Klien: satu pengelola pembaruan (singleton)
- Satu koneksi EventSource per tab browser, dikelola satu modul (hook/provider) yang
  ditambahkan di layout tanpa mengubah komponen halaman yang ada, selain
  menghubungkannya ke kunci cache mereka.
- Pembaruan yang diterapkan:
  * "log.baru": hanya jika tab Event Log terbuka, mode Live aktif, dan pengguna berada
    di bagian atas daftar. Ambil baris baru lewat endpoint cursor yang sudah ada
    (id lebih besar dari yang terakhir), dan tambahkan di atas. Jika pengguna sedang
    scroll ke bawah atau punya filter rentang yang tidak mencakup "sekarang", jangan
    sisipkan baris; tampilkan chip kecil "12 log baru" yang bila diklik memuat baris
    baru. Baris baru hanya masuk bila cocok dengan filter aktif.
  * "perangkat.status" / "perangkat.ping": perbarui hanya objek perangkat itu
    (setQueryData) pada daftar, kartu dashboard, dan header detail. Tanpa fetch bila
    event sudah berisi nilai barunya.
  * "insiden.berubah": ambil hanya insiden itu (by id) lalu sisipkan/perbarui di
    daftar dan perbarui hitungan; tanpa memuat ulang seluruh daftar.
  * "statistik.diperbarui" / "pengiriman_log.berubah": invalidasi HANYA kunci cache
    yang aktif (sedang tampil) dan hanya untuk perangkat itu; grafik/riwayat hanya
    menambah atau memperbarui slot yang terpengaruh (slot terakhir), bukan memuat
    ulang seluruh rentang. Jika endpoint yang ada belum mendukung, tambahkan parameter
    opsional ?sejak=<versi/waktu> yang hanya mengembalikan slot yang berubah.
  * "analisa.selesai": perbarui panel analisa perangkat/insiden itu saja.
  * "perangkat.diubah": perbarui baris/header perangkat itu.
- Aturan umum: query yang tidak sedang tampil tidak di-refetch (cukup ditandai basi
  untuk dimuat saat dibuka). Dedupe permintaan identik. Debounce pembaruan 300-500 ms
  agar satu rentetan event hanya memicu satu ambil-ulang.
- Tab tersembunyi (visibilitychange): tutup koneksi SSE setelah 60 detik
  disembunyikan; saat tab terlihat lagi, sambung ulang dengan Last-Event-ID dan
  ambil ulang hanya tampilan aktif jika perlu (resync).
- Sambung ulang otomatis dengan backoff eksponensial (1s, 2s, 5s, 10s, maks 30s)
  ditambah jitter. Tidak ada badai sambung ulang.
- Tangani 401: arahkan ke /login dengan pesan sesi berakhir (perilaku yang sama
  seperti sekarang).

D. Cadangan (fallback) jika SSE tidak tersedia
- Bila SSE gagal tersambung 3 kali berturut-turut (misalnya proxy memblokir
  streaming), beralih ke polling ringan: hanya untuk data tampilan yang aktif,
  interval 15 detik, memakai ETag/If-None-Match atau parameter ?sejak sehingga
  respons 304/kecil saat tidak ada perubahan. Berhenti saat tab tersembunyi.
  Coba SSE lagi tiap 2 menit; bila berhasil, matikan polling.
- Mode Live Event Log yang sudah ada tidak diubah perilakunya selain memakai
  mekanisme ini sebagai pemicu; pastikan tidak ada dua mekanisme (polling lama +
  SSE) yang berjalan bersamaan untuk data yang sama. Hapus/nonaktifkan polling lama
  yang menjadi tumpang tindih, dan laporkan apa yang dihapus.

E. Indikator koneksi (minimal, mengikuti gaya yang ada)
- Titik kecil di header (sisi kanan, dekat nama pengguna): tidak tampil saat normal.
  Saat terputus lebih dari 10 detik tampil teks kecil "Menyambung ulang..." dengan
  tooltip penjelasan, dan hilang saat tersambung. Tanpa emoji, warna tema yang ada.
  Jangan menambah elemen lain.

F. Infrastruktur / Coolify
- Pastikan endpoint stream tidak di-buffer atau dikompres oleh proxy, dan timeout
  idle proxy lebih panjang dari interval heartbeat. Catat pengaturan yang perlu di
  Traefik/Coolify (dan bila domain di belakang Cloudflare, catat bahwa streaming
  bisa tertahan dan fallback polling akan aktif).
- Tidak menambah service baru. Jika aplikasi berjalan lebih dari satu instance,
  pub/sub Redis memastikan semua instance menerima event.
- Tambahkan bagian README "Pembaruan langsung": cara kerja, batas koneksi, dan cara
  mematikan fitur lewat env (LIVE_UPDATES=false mengembalikan perilaku lama).

G. Keamanan
- Event diperiksa terhadap izin pengguna di server (bukan hanya disaring di klien).
- Tidak ada data sensitif dalam event. Tidak ada aksi mengubah data lewat kanal ini.
- Batasi laju koneksi dan sambung ulang per pengguna/IP.
- Perangkat yang dinonaktifkan/dihapus: event dihentikan dan klien menghapusnya dari
  tampilan.

LANGKAH 3 - TES (tampilkan hasilnya)
- Regresi: bandingkan respons semua endpoint lama sebelum/sesudah; field lama harus
  identik. Tampilan semua halaman tidak berubah (screenshot sebelum/sesudah).
  Jalankan lint, typecheck, dan seluruh tes yang ada; tidak boleh ada yang gagal.
- Pembaruan langsung tanpa refresh (dua jendela browser):
  * Kirim log baru: muncul di atas Event Log (Live aktif, di posisi atas) tanpa
    refresh; saat scroll di bawah muncul chip "N log baru".
  * Ubah status/ping perangkat: kartu dashboard, daftar perangkat, dan header detail
    berubah tanpa refresh.
  * Insiden baru dan perubahan statusnya muncul di daftar dan hitungan.
  * Slot terakhir riwayat status, baris ping, dan baris pengiriman log diperbarui
    tanpa memuat ulang seluruh rentang.
  * Analisa AI selesai: panel terisi tanpa refresh.
- Hanya data berubah yang diambil: catat jumlah dan ukuran request selama 5 menit
  dengan dan tanpa aktivitas. Saat tidak ada perubahan, request data ~0 (selain
  heartbeat). Saat 1 perangkat berubah, hanya data perangkat itu yang diambil.
  Tunjukkan perbandingan terhadap perilaku lama.
- Tidak ada fetch ganda: pada satu event, satu permintaan per kunci cache.
- Gangguan pengguna: modal detail baris, form, filter, dan posisi scroll tidak
  berubah saat pembaruan datang.
- Ketahanan: putuskan jaringan 10 detik lalu sambung -> event terlewat diterima
  (Last-Event-ID); putus 5 menit -> resync hanya tampilan aktif; restart app -> klien
  tersambung ulang tanpa badai; sesi berakhir -> diarahkan ke login.
- Fallback: blokir streaming (simulasi) -> beralih ke polling ringan, lalu kembali ke
  SSE saat tersedia.
- Beban: 3000 pesan log/detik selama 2 menit -> event "log.baru" <= 1/detik/perangkat,
  CPU/memori app stabil. 100 koneksi klien bersamaan -> memori stabil, tidak ada
  kebocoran listener (periksa setelah 100 koneksi dibuka-tutup).
- Keamanan: tanpa sesi -> 401; viewer tidak menerima event perangkat di luar izinnya;
  event tidak memuat token atau raw log.
- Tab tersembunyi: koneksi ditutup setelah 60 detik dan tersambung lagi saat terlihat.

LAPORAN AKHIR (wajib)
- Daftar file yang ditambah/diubah, polling lama yang dihapus atau digantikan,
  dan konfirmasi tertulis bahwa tampilan, perhitungan, dan fitur lain tidak berubah.
- Tabel metrik request sebelum vs sesudah.
- Variabel env baru dan catatan konfigurasi Coolify/Traefik.