TUGAS: Tambahkan diagnostik penerimaan log supaya alasan "log tidak masuk" terlihat di
aplikasi, dan perbaiki dua ketidakkonsistenan tampilan pada detail perangkat. Hanya
menambah dan memperbaiki hal ini.

KASUS: Perangkat SERVER181 (MikroTik, RouterOS v7) berstatus Nonaktif dan IP-nya tampil
"HTTP Ingest". MikroTik sudah dikonfigurasi mengirim syslog UDP ke server port 5514, tetapi
Event Log menampilkan "0 dari 0 log" tanpa penjelasan. Header juga menampilkan badge
"UP Online" padahal perangkat Nonaktif.

ATURAN KERAS
- Jangan mengubah fitur, tampilan, perhitungan, aturan deteksi, parser, atau endpoint
  lain. Respons endpoint lama tidak berubah (hanya aditif). Tema dan gaya tetap (terang,
  garis tipis biru/merah, tanpa gradient/glow/emoji, Bahasa Indonesia yang spesifik).
- Pakai ulang antrian, Redis, SSE, hook mutasi, dan komponen yang sudah ada. Tidak ada
  tabel/worker/job duplikat, tidak ada fetch ganda.
- Keamanan: sumber syslog dapat dipalsukan (spoofing) dan UDP dapat dibanjiri. Daftar sumber
  tidak dikenal harus dibatasi (maks 100 entri, TTL 24 jam, hitung agregat saja), hanya
  admin yang melihat, tidak pernah mendaftarkan perangkat otomatis, dan isi pesan mentah
  dari sumber tidak dikenal TIDAK disimpan.
- Jika ragu, jangan ubah dan tanyakan.

LANGKAH 1 - DIAGNOSIS (jangan ubah kode dulu)
a. Tunjukkan jalur penerimaan: kapan collector menolak pesan (perangkat nonaktif, IP tidak
   terdaftar, token salah, rate limit, pesan terlalu besar, format tak terbaca), dan counter
   Redis apa yang sudah dicatat (mis. unknown_sources) beserta apakah ditampilkan di UI.
b. Bagaimana status Aktif/Nonaktif memengaruhi ping dan badge "UP Online" di header.
c. Mengapa IP tampil "HTTP Ingest": apakah ip_address kosong di database atau kesalahan
   tampilan. Tampilkan nilai di database untuk SERVER181.
d. Apakah parser MikroTik menangani format RouterOS v7 "default" DAN "syslog" (dengan dan
   tanpa topik di awal pesan). Tunjukkan contoh raw untuk keduanya.
Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI
1. Hitung penolakan per alasan: nonaktif, ip_tidak_terdaftar, token_salah, rate_limit,
   ukuran, tidak_terbaca. Per perangkat dan global, agregat per jam di Redis dengan TTL.
   Catat juga waktu paket terakhir yang diterima per perangkat (termasuk yang ditolak).
2. Event Log kosong: tampilkan penyebab yang spesifik, mis.
   - perangkat nonaktif: "Perangkat ini nonaktif, jadi log yang dikirim ditolak. Aktifkan
     perangkat." (tombol Aktifkan untuk admin)
   - perangkat tanpa IP terdaftar: "Perangkat ini belum punya IP sumber. Syslog dikenali dari
     IP pengirim. Isi IP di Edit, atau pakai HTTP Ingest dengan token."
   - paket terakhir ditolak: "Paket dari 103.x.x.x diterima 2 menit lalu tetapi ditolak:
     alasan."
   - tidak ada paket sama sekali: "Belum ada paket dari perangkat ini. Periksa konfigurasi di
     panel Cara mengirim log."
   Pesan "Tidak ada log yang sesuai filter" hanya bila perangkat memang menerima log di
   luar filter.
3. Panel admin "Sumber tidak dikenal" (di /pengaturan atau tab Konfigurasi Perangkat): daftar IP
   yang mengirim paket tetapi tidak cocok perangkat mana pun, jumlah paket, waktu terakhir,
   dan tombol "Daftarkan sebagai perangkat" yang membuka form tambah perangkat dengan IP
   terisi dan membutuhkan konfirmasi admin. Atau "Pasangkan ke perangkat yang ada" untuk
   mengisi IP perangkat tanpa IP.
4. Header detail perangkat: tampilkan metode penerimaan secara jujur (Syslog dari IP x.x.x.x,
   HTTP Ingest dengan token, atau belum dikonfigurasi). Bila ip_address terisi, tampilkan IP
   itu dan jangan "HTTP Ingest".
5. Konsistensi status: perangkat Nonaktif menampilkan badge "Nonaktif" dan tidak menampilkan
   "UP Online" maupun melakukan ping/notifikasi RTO (sesuai aturan perangkat nonaktif).
6. Panel "Cara mengirim log" untuk MikroTik RouterOS v7: tambahkan rekomendasi
   remote-log-format=syslog + Add Topics, satu rule per topik di /system logging, dan
   src-address yang sama dengan IP terdaftar. Contoh perintah uji /log info dan cara
   membaca tcpdump.
7. Parser: pastikan pesan RouterOS v7 format default dan syslog sama-sama terurai, termasuk
   topik di awal pesan ke parsed.topics dan severity sesuai aturan yang sudah ada. Tambahkan
   unit test untuk kedua format.

LANGKAH 3 - TES
- Kirim syslog dari IP terdaftar ke perangkat nonaktif: ditolak, alasan "nonaktif" tampil di
  Event Log; setelah Aktifkan, log masuk.
- Kirim dari IP tidak terdaftar: muncul di "Sumber tidak dikenal"; daftarkan lewat tombol;
  log berikutnya masuk. Tidak ada pendaftaran otomatis.
- Banjir 10.000 paket dari 500 IP acak: daftar sumber tidak dikenal tetap <= 100 entri,
  memori Redis stabil, ingest perangkat lain tidak terganggu.
- Perangkat nonaktif: tidak ada badge UP Online, tidak ada ping, tidak ada notifikasi.
- Regresi: semua fitur lain berperilaku sama, respons endpoint lama identik, lint,
  typecheck, seluruh tes lama lulus.
LAPORAN AKHIR: perubahan, file yang diubah, dan konfirmasi fitur lain tidak berubah.