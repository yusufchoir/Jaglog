TUGAS: Tambahkan pengaturan rentang waktu dan skala (granularitas) pada kartu
"Ketersediaan & Riwayat Status" di tab Ringkasan detail perangkat. MELENGKAPI
komponen yang sudah ada. Jangan membuat ulang kartu, jangan mengubah tema, warna,
atau gaya yang sudah ada.

LANGKAH 1 - INVENTARIS (jangan ubah kode dulu)
Laporkan: komponen kartu riwayat status (file), endpoint/query yang memberi data
slot saat ini, sumber datanya (device_status_history, ping_results, atau log),
cara slot 4 jam dihitung, cara uptime 24 jam/7 hari dihitung, dan retensi
masing-masing tabel. Berhenti dan tunggu "lanjut".

LANGKAH 2 - IMPLEMENTASI

A. Sumber data
- Hitung slot dari tabel riwayat status yang berisi interval perubahan status
  (device_status_history: status, started_at, ended_at; ended_at null = masih
  berlangsung sampai sekarang). Hitung durasi tiap status per slot lewat tumpang
  tindih interval (overlap) di SQL. Dengan begitu SEMUA skala bisa dihitung dari
  satu sumber, tanpa tabel baru dan tanpa memindai log_events atau ping_results.
- Jika riwayat status belum mencakup log/ping (hanya satu jenis), gabungkan
  menjadi status akhir per interval dengan aturan yang sudah ada:
  online, log_stopped, offline, unknown.
- Pastikan retensi riwayat status minimal 400 hari (datanya kecil karena hanya
  mencatat perubahan status). Jangan ikut dihapus oleh retensi log 30 hari.
- Waktu "belum ada data": periode sebelum perangkat dibuat, sebelum baris riwayat
  pertama, atau saat monitoring tidak berjalan.

B. Endpoint (satu endpoint, satu request per tampilan kartu)
- GET /api/perangkat/{id}/riwayat-status?rentang=24j|7h|30h|90h|1t|kustom
  &skala=otomatis|15m|30m|1j|4j|6j|1h|1m|1b&dari=...&sampai=...
  (h=hari, m=minggu, b=bulan, t=tahun; sesuaikan penamaan dengan konvensi yang
  sudah ada di kode).
- Validasi dengan Zod: hanya kombinasi rentang-skala yang valid; jumlah slot harus
  antara 12 dan 96; rentang kustom maksimal 400 hari; "dari" < "sampai".
- Batas slot memakai zona waktu Asia/Jakarta: hari mulai 00:00 WIB, minggu mulai
  Senin, bulan mulai tanggal 1. Slot pertama dan terakhir yang belum penuh ditandai
  "sebagian".
- Respons: daftar slot { mulai, selesai, status, uptime_persen, detik_online,
  detik_log_berhenti, detik_offline, detik_tanpa_data, jumlah_gangguan } plus
  ringkasan { uptime_persen, total_downtime_detik, jumlah_gangguan,
  gangguan_terlama_detik, cakupan_data_persen }.
- Cache Redis dengan TTL 30-60 detik per kombinasi (perangkat, rentang, skala),
  TTL lebih panjang untuk slot yang sudah lewat. Tidak boleh ada fetch ganda di UI:
  satu query per perubahan pilihan, dengan dedupe dan keepPreviousData agar kartu
  tidak berkedip.

C. Aturan warna slot
- "Belum Ada Data": jika detik_tanpa_data >= 50% dari slot.
- Selain itu, tentukan dari persentase waktu bermasalah di slot:
  * Offline (merah): waktu offline >= ambang_offline
  * Log Berhenti (kuning): waktu log berhenti >= ambang_log, bila tidak offline
  * Online (hijau): selain itu
- Ambang bergantung skala agar gangguan singkat tidak mewarnai satu hari penuh:
  skala <= 1 jam: ambang 1 menit; 4-6 jam: 2%; 1 hari: 1%; 1 minggu dan 1 bulan: 0,5%.
  Simpan ambang sebagai konstanta terpusat (mudah diubah), bukan tersebar.
- Slot yang punya gangguan kecil di bawah ambang tetap hijau, tetapi tooltip
  menyebutkan gangguannya.
- Gunakan warna dan legenda yang sudah ada (Online, Log Berhenti, Offline, Belum
  Ada Data). Jangan menambah warna baru.

D. Perhitungan uptime
- Uptime = detik_online / (detik_online + detik_log_berhenti + detik_offline).
  Periode "tanpa data" TIDAK dihitung. Jika cakupan data kurang dari 100%,
  tampilkan keterangan kecil: "Berdasarkan 6 jam data dari 7 hari" dan bila seluruh
  rentang tanpa data tampilkan "-" bukan 100%.
- Perbaiki juga angka Uptime 24 Jam dan 7 Hari yang sudah ada agar memakai
  rumus yang sama.
- Format angka Indonesia (koma desimal), satu angka di belakang koma (99,8%).

E. UI (komponen dan gaya yang sudah ada)
- Di kepala kartu, tambahkan:
  * Kontrol segmen "Rentang": 24 Jam | 7 Hari | 30 Hari | 90 Hari | 1 Tahun | Kustom
  * Dropdown "Skala": Otomatis + pilihan yang valid untuk rentang terpilih
    (pilihan tidak valid disembunyikan)
  * Pada Kustom: pemilih tanggal awal dan akhir
- Subjudul dinamis, contoh: "42 slot waktu (interval 4 jam) berdasarkan log syslog &
  ping server." Label kiri dan kanan bar mengikuti rentang ("7 hari lalu" ... "Hari ini",
  "1 tahun lalu" ... "Bulan ini").
- Kartu ringkasan kanan atas: uptime untuk rentang yang dipilih, ditambah
  "Total gangguan" dan "Gangguan terlama". Tetap tampilkan Uptime 24 Jam dan 7 Hari
  bila rentang yang dipilih berbeda.
- Tooltip tiap slot (juga muncul saat fokus keyboard): rentang waktu WIB, status
  dominan, uptime slot, durasi offline/log berhenti, jumlah gangguan. Contoh:
  "Sen, 3 Nov 08.00-12.00 WIB - Offline 14 menit (1 gangguan) - Uptime 94,2%".
- Klik slot: tampilkan daftar gangguan di slot itu (mulai, selesai, durasi, status)
  di panel kecil di bawah bar, dengan tautan ke tab Log pada rentang waktu yang sama.
- Pilihan tersimpan di URL (?rentang=30h&skala=1h) supaya bisa dibagikan, dan
  diingat per pengguna untuk kunjungan berikutnya.
- Responsif: pada layar sempit, bar boleh scroll horizontal atau jumlah slot
  otomatis dikurangi (naikkan skala) agar tiap slot minimal 8 px.
- Skeleton saat memuat, pesan jelas bila gagal ("Gagal memuat riwayat. Coba lagi")
  dengan tombol muat ulang. Tidak ada kegagalan diam-diam.
- Aksesibilitas: segmen dan dropdown bisa dioperasikan keyboard, bar punya
  aria-label ringkasan, status tidak hanya dibedakan lewat warna (tooltip dan
  legenda berisi teks).

LANGKAH 3 - TES
- Unit test fungsi overlap interval: interval yang melewati batas slot, interval
  yang masih berjalan, riwayat kosong, perangkat baru, pergantian bulan, hari
  dengan DST tidak relevan (WIB tetap UTC+7).
- Tes endpoint: tiap kombinasi rentang-skala yang valid mengembalikan jumlah slot
  benar (24j/30m = 48, 7h/4j = 42, 30h/1h = 30, 90h/1h = 90, 1t/1m = 52, 1t/1b = 12),
  kombinasi tidak valid ditolak dengan pesan jelas.
- Tes uptime: perangkat baru dengan data 6 jam menampilkan keterangan cakupan,
  bukan 100%.
- Uji performa dengan data seed 1 tahun dan 20 perangkat: p95 endpoint < 300 ms,
  dan hanya 1 request per perubahan pilihan.
- Tampilkan screenshot untuk 24 Jam, 7 Hari, 30 Hari, 1 Tahun, dan Kustom.
- Jalankan lint, typecheck, seluruh tes. Ringkas file yang diubah.Zhhcdikypi ;;p]k[kzs]