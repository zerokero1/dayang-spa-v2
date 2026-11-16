# Catatan SQL dan database

Folder ini berisi skrip SQL historis. **Tidak ada satu file pun yang menjadi
sumber kebenaran skema produksi.** Sumber kebenarannya adalah database live.

## Aturan aman

1. **Jangan jalankan ulang `schema.sql` atau `MASTER_PATCH_LATEST.sql`.**
   Keduanya snapshot lama dan bisa menurunkan versi RPC `create_booking` serta
   mengembalikan kebijakan RLS yang sudah diperbaiki.
2. Sebelum perubahan apa pun: ambil dump database produksi, lalu uji skrip di
   salinan.
3. Satu perubahan = satu file, beri tanggal di nama file, dan catat maksudnya di
   pesan commit. Jangan mengedit file yang sudah pernah dijalankan di produksi.
4. Skrip diagnostik sekali pakai (mis. `*_temp.sql` atau `cek_booking_berjalan_*.sql`)
   hanya untuk lokal dan tidak di-commit. Polanya sudah ada di `.gitignore`.

## Patch yang perlu diingat

| File | Isi |
| --- | --- |
| `produk_treatment_auto_stok.sql` | Versi RPC `create_booking` terbaru + konsumsi stok produk. |
| `absensi_otomatis.sql` | Log absensi otomatis. |
| `fix_attendance_auto_log_rls.sql` | Perbaikan RLS untuk log absensi otomatis. |
| `fix_stok_laundry_nama_20261021.sql` | Perbaikan nama barang stok laundry. |

Urutan penerapan patch lama tidak tercatat rapi. Kalau perlu menyentuh RPC atau
RLS, mulai dari dump database terbaru, bukan dari file di folder ini.

## Akses database

- Port `5432` tidak terbuka dari internet; sambungkan lewat SSH tunnel ke VPS.
- Kredensial lokal ada di `.env-pg` (gitignored). Jangan pernah commit isinya.

## RLS: kondisi sekarang dan target

Kondisi sekarang: 21 kebijakan `using (true)` dan 18 `with check (true)` tersebar
di file SQL (10 di antaranya di `schema.sql`). Artinya pembatasan peran di UI
tidak ditegakkan oleh database.

Target (belum diterapkan, wajib diuji di salinan):

| Peran | Aturan |
| --- | --- |
| `admin_pusat` | Semua outlet dan semua tabel. |
| `kasir` | Hanya outlet yang terikat; boleh menulis transaksi dan membaca laporan outletnya. |
| `order_taker` | Hanya booking/reservasi yang dibuatnya; tanpa akses stok, komisi, dan absensi. |
| `anon` | Tanpa akses tabel; hanya RPC yang memang publik. |

Langkah aman: buat policy baru di samping policy lama, uji dengan akun nyata,
lalu hapus policy lama di jendela pemeliharaan.
