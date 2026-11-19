TUGAS: Tambahkan perlindungan terhadap log berulang yang membanjiri (flood) per
perangkat. MELENGKAPI fitur yang sudah ada. Jangan ubah tema atau fitur lain.

MASALAH
Perangkat "Main Mikrotik" mengirim pesan "Download from jagalog.maudynetwork.id
FINISHED" terus-menerus (loop dari script fetch di MikroTik). Event Log penuh dengan
pesan itu sehingga log penting tidak terlihat.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan: berapa baris dan persen pesan itu dari log Main Mikrotik 24 jam terakhir,
lajunya per menit, dan apakah ada rate limit, dedupe, atau filter di collector/worker
saat ini. Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Aturan abaikan (noise filter) per perangkat dan global
- Tabel log_filters: id, device_id (null = semua perangkat), nama, tipe_cocok
  (mengandung | persis | regex), pola, aksi (buang | gabung | turunkan_severity),
  is_active, jumlah_cocok, terakhir_cocok, dibuat_oleh, created_at.
- Pola dicocokkan terhadap message setelah diparse. Regex wajib aman: pakai pustaka
  yang tahan ReDoS (RE2) atau batasi panjang pola dan waktu eksekusi.
- Pencocokan efisien: kompilasi pola sekali, cache di memori worker (invalidasi saat
  filter berubah), tidak ada query database per pesan.
- Aksi "buang": pesan tidak disimpan ke log_events, hanya menambah penghitung di
  Redis (jumlah dibuang per filter per hari). Aksi "gabung": lihat poin B.
  Aksi "turunkan_severity": simpan tetapi severity jadi 7 (debug).
- Filter hanya bisa dikelola admin. Perubahan masuk ke audit log.

B. Gabung pesan berulang (dedupe)
- Pesan dengan isi sama dari perangkat yang sama dalam jendela 60 detik digabung
  menjadi satu baris dengan repeat_count (contoh: "diulang 120 kali dalam 60 detik",
  waktu pertama dan terakhir). Gunakan kunci Redis (device_id + hash pesan
  yang sudah dinormalisasi: angka, IP, dan MAC diganti penanda) dengan TTL.
- Baris gabungan di-update saat jendela selesai atau saat batas 60 detik, bukan
  tiap pesan, agar tidak menambah beban database.
- Event Log menampilkan "x120" di samping pesan, detail baris menunjukkan waktu
  pertama dan terakhir.

C. Deteksi banjir otomatis (pakai rule engine yang sudah ada)
- Aturan log_flood: satu pola pesan (hasil normalisasi) > 30 kali per menit selama
  3 menit berturut-turut dari satu perangkat, ATAU satu pola > 50% dari seluruh log
  perangkat dalam 10 menit.
- Saat terpicu: buat satu insiden (severity medium) berisi pola teratas, laju per
  menit, dan persentase. Terapkan perlindungan sementara otomatis: gabung pesan
  tersebut (poin B) sampai banjir reda, dan jangan simpan lebih dari 1 baris per
  menit untuk pola itu.
- Rekomendasi insiden (statis, tanpa AI wajib): "Pesan ini kemungkinan berasal dari
  script atau scheduler yang memicu log baru (loop). Periksa /system scheduler dan
  /system script di perangkat, atau gunakan syslog sebagai pengganti fetch."
  Bila pesan mengandung domain aplikasi sendiri (APP_BASE_URL), jelaskan bahwa
  ini hampir pasti loop dari script pengirim log.
- Tombol di insiden: "Buat aturan abaikan dari pola ini" (isi otomatis pola dan
  tipe cocok, admin tinggal konfirmasi).
- Notifikasi (channel yang sudah ada) untuk insiden log_flood dengan batas anti-spam
  yang sama.

D. Batas laju per perangkat (pengaman terakhir)
- Rate limit pesan per perangkat (default 200 pesan per detik, bisa diatur).
  Pesan yang melampaui batas dibuang dan dihitung; tampilkan jumlahnya di UI.
- Jika satu pola menyumbang mayoritas pesan yang dibuang, catat di insiden.

E. Saran awal otomatis
- Tambahkan filter yang disarankan (nonaktif secara default, admin yang mengaktifkan)
  untuk pola umum: pesan yang berisi domain aplikasi sendiri pada topik fetch
  ("Download from <domain> FINISHED", "Upload to ... FINISHED").

F. UI (gaya dan komponen yang sudah ada, tanpa emoji, Bahasa Indonesia)
- Di tab "Konfigurasi Perangkat": bagian "Filter log" untuk perangkat itu dan di
  /pengaturan untuk filter global: daftar filter, tombol tambah/ubah/hapus/aktifkan,
  jumlah log yang dibuang, terakhir cocok.
- Tombol "Uji pola": pratinjau berapa log 24 jam terakhir yang cocok dan 5 contoh,
  sebelum disimpan. Batasi pencarian pratinjau ke 24 jam agar cepat.
- Di Event Log: tombol pada baris detail "Abaikan pesan seperti ini" yang membuka
  form filter dengan pola terisi.
- Di Event Log: toggle "Sembunyikan pesan berulang" (default aktif) dan chip
  "Ada 14.200 pesan serupa digabung/dibuang. Lihat".
- Di tab Ringkasan perangkat: kartu "Pesan paling sering" (top 5 pola 24 jam,
  jumlah dan persen) dari data teragregasi, bukan scan log mentah.
- Semua tombol memakai hook mutasi bersama (loading, toast, penanganan error).

G. Pembersihan data yang sudah membanjir
- Tombol admin "Hapus log dengan pola ini" (dengan konfirmasi menyebut jumlah baris,
  dan batas rentang waktu). Hapus bertahap per batch 5.000 baris agar tidak
  mengunci tabel, jalankan sebagai job latar belakang dengan indikator progres.
- Perbarui tabel ringkasan per jam setelah penghapusan (atau hitung ulang untuk
  rentang itu).

H. Performa
- Tidak ada query tambahan per pesan; seluruh keputusan filter dan dedupe memakai
  cache memori dan Redis. Tidak ada fetch ganda di UI.

LANGKAH 3 - TES
- Simulasi 5.000 pesan identik "Download from jagalog.maudynetwork.id FINISHED"
  dalam 1 menit bercampur 50 pesan lain: penyimpanan database < 100 baris untuk
  pesan identik, 50 pesan lain tersimpan semua, penghitung benar.
- Insiden log_flood terbentuk satu kali, rekomendasi tampil, tombol "Buat aturan
  abaikan" mengisi pola dengan benar.
- Filter regex jahat (pola ReDoS) ditolak atau dibatasi waktunya.
- Aksi gabung, buang, dan turunkan severity masing-masing diuji.
- Pembersihan 100.000 baris berjalan bertahap tanpa mengunci Event Log.
- Pastikan log penting (warning/error) tidak pernah terbuang oleh filter bawaan.
- Tampilkan screenshot Event Log sebelum dan sesudah, kartu "Pesan paling sering",
  dan form filter. Jalankan lint, typecheck, dan seluruh tes.
  