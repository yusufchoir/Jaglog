TUGAS: Audit performa JagaLog lalu optimasi untuk pemakaian jangka panjang.
Kerjakan dalam 3 tahap. Berhenti setelah tahap 1 dan tahap 2, tunggu "lanjut".

TAHAP 1 - AUDIT (jangan ubah kode dulu)
Periksa seluruh kode dan hasilkan laporan berisi temuan, file:baris, dampak
(tinggi/sedang/rendah), dan usulan perbaikan. Cari secara spesifik:

A. Panggilan ganda
- Data yang diambil di server component DAN di client untuk halaman yang sama.
- useEffect tanpa cleanup, interval/polling yang tidak dihentikan saat komponen
  unmount atau tab tersembunyi, dependency array yang membuat fetch berulang.
- Beberapa komponen memanggil endpoint yang sama pada satu halaman tanpa dedupe.
- Query N+1 (query di dalam loop, satu query per kartu perangkat).
- Endpoint API yang dipanggil berulang untuk data yang sama dalam satu request.
- Dua worker atau job yang melakukan pekerjaan sama (status perangkat vs
  device_silent, analisa AI otomatis vs manual).
- Repeatable job BullMQ yang terdaftar ulang tiap start, atau job duplikat.
- Panggilan AI duplikat untuk data yang sama.

B. Query dan database
- Jalankan EXPLAIN ANALYZE untuk semua query dashboard, daftar log, rule engine,
  dan top-N (IP, akun). Laporkan yang memakai Seq Scan pada log_events.
- COUNT(*) atau agregasi langsung ke log_events untuk tampilan UI.
- Pagination memakai OFFSET pada tabel besar.
- Index yang tidak terpakai atau kurang (pg_stat_user_indexes).
- Ukuran pool koneksi Postgres di app, worker, collector (total tidak boleh
  melebihi max_connections).

C. Pipeline ingest
- Operasi per pesan yang seharusnya per batch (update last_seen_at, query device,
  panggilan Redis).
- Lookup device per pesan tanpa cache.
- Backpressure: apa yang terjadi bila Postgres lambat dan antrian penuh.

D. Frontend
- Ukuran bundle per halaman, library besar yang dimuat di semua halaman.
- Tabel log tanpa virtualisasi, re-render berlebihan.
- Chart yang dirender ulang tiap polling.

E. Redis dan memori
- Job selesai/gagal yang tidak dihapus, key tanpa TTL, cache tanpa batas.
- Konfigurasi maxmemory dan kebijakan eviction.

Buat tabel