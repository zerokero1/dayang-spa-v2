# Dayang Spa PWA

Aplikasi manajemen operasional Dayang Spa: kasir, oncall, reservasi, status terapis, absensi, stok, komisi, dan laporan. Berjalan sebagai PWA (bisa dipasang di HP/tablet) dengan backend Supabase self-host.

## Stack

- React 18 + Vite 5
- Supabase JS (auth, database, RPC)
- `vite-plugin-pwa` (service worker, manifest, auto update)
- ExcelJS untuk ekspor laporan
- ESLint 9 + `node:test` untuk pemeriksaan kualitas

## Menjalankan

```bash
npm install
cp .env.example .env   # lalu isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
npm run dev
```

Build produksi:

```bash
npm run build     # menjalankan lint + tes + cek halaman, lalu vite build
npm run preview   # melihat hasil build
```

Perintah lain:

| Perintah | Kegunaan |
| --- | --- |
| `npm run lint` | ESLint untuk seluruh `src/` |
| `npm test` | Tes unit modul murni (zona waktu, shift, stok) |
| `npm run cek:halaman` | Memastikan semua halaman bisa diimpor tanpa error |
| `npm run cek` | lint + test + cek halaman |

## Struktur

```
src/
  App.jsx                 # shell aplikasi, menu, routing berbasis state
  pages/                  # 35 halaman (kasir, laporan, absensi, stok, ...)
  components/             # komponen bersama (receipt, reminder, grid absensi)
  lib/
    supabase.js           # klien Supabase
    businessDate.js       # SATU SUMBER zona waktu bisnis (WITA)
    shiftService.js       # SATU SUMBER definisi shift, telat, lembur
    bookingService.js     # transaksi & RPC booking
    reportService.js      # laporan harian/rentang
    stockUsageService.js  # buku stok & pemakaian produk
    ...
  styles*.css             # tema, komponen UI, gaya laporan
supabase/                 # skema & patch SQL (lihat catatan migrasi)
test/                     # tes unit node:test
docs/                     # dokumen operasional & migrasi VPS
```

## Zona waktu

Seluruh perhitungan tanggal bisnis memakai **WITA / Asia/Makassar (UTC+8)**, bukan zona waktu perangkat. Gunakan helper di `src/lib/businessDate.js` (`businessDate`, `businessRangeBoundsUtc`, `businessMinutesOfDay`) dan jangan menulis offset manual seperti `+ 7 * 3600000`.

Definisi shift, jam mulai (patokan telat), dan jam selesai (patokan lembur) hanya boleh didefinisikan di `src/lib/shiftService.js` (`SHIFT_DEFS`). Label jam di grid jadwal diturunkan otomatis dari sana.

## Peran pengguna

- `admin_pusat` — akses penuh, bisa memilih outlet.
- `kasir` — tampilan sederhana (beranda tombol besar + tab bawah), terikat satu outlet.
- `order_taker` — hanya halaman Ambil Order, Payment & List, dan Ringkasan.
- Akun office (`office.op@dayang.com`) mendapat halaman bertanda `officeOnly`.

Pembatasan peran di UI **bukan** pengganti RLS. Pastikan kebijakan RLS di database tetap benar.

## Catatan migrasi database

- `supabase/schema.sql` dan `supabase/MASTER_PATCH_LATEST.sql` **tidak selalu mencerminkan database produksi**. Jangan menjalankan ulang patch lama tanpa memeriksa urutannya karena bisa menurunkan versi RPC `create_booking`.
- Patch terbaru untuk transaksi + konsumsi stok produk ada di `supabase/produk_treatment_auto_stok.sql`.
- Selalu uji di database salinan sebelum menjalankan SQL di produksi.

## Deploy

Panduan VPS (domain, reverse proxy, Supabase) ada di `docs/MIGRASI_VPS.md`. Jangan commit file `.env`, `.env-pg`, atau folder backup.
