# Rencana perbaikan

Diperbarui: 17 November 2026

Prinsip kerja: perubahan yang menyentuh alur kasir (buat pesanan, bayar, struk)
diuji di salinan lebih dulu dan dipasang di jam sepi. PWA memakai prompt update,
bukan reload otomatis, supaya transaksi tidak terputus saat kasir bekerja.

## Sudah selesai

| Area | Hasil |
| --- | --- |
| Zona waktu | Semua tanggal bisnis memakai WITA lewat `src/lib/businessDate.js`. Simbol `wib*` sudah diganti `wita*`; kolom database `wib_date` sengaja tidak diubah. |
| Shift | `SHIFT_DEFS` + `shiftJamLabel` menjadi satu sumber; label jam di grid jadwal diturunkan otomatis. |
| Laporan | Perbaikan `rangeIso`, detail pemakaian stok, riwayat Pemeriksaan Sistem, serta ringkasan kas lunas dan belum bayar. |
| Ekspor Excel | `fetchAllRows` (`src/lib/supabasePaging.js`) mengambil semua baris bertahap. Sebelumnya server memotong tiap query di 1.000 baris, jadi laporan rentang tanggal kehilangan transaksi (Sep 4.159 → hanya 1.000) dan totalnya tidak balance, walau per tanggal benar. |
| Rekap mingguan/bulanan | Laporan Keuangan punya pilihan cepat 7 hari, 30 hari, minggu ini, bulan ini, dan bulan lalu. Satu query rentang menggantikan puluhan request per hari, dan refresh 60 detik tidak lagi mengembalikan rentang ke tanggal hari ini. |
| Update PWA | `registerType: 'prompt'` + `PwaUpdatePrompt`: banner "Versi baru tersedia", cek tiap 30 menit, tidak ada reload diam-diam. |
| Offline | `OfflineBanner` menyatakan jujur bahwa transaksi belum bisa disimpan; login saat offline tidak lagi dibilang "password salah". |
| Ketahanan UI | `ErrorBoundary` per halaman di shell admin dan shell kasir. |
| Tampilan & navigasi | `RentangTanggal` jadi pemilih tanggal standar halaman laporan (preset aktif, rentang tak terbalik, muat otomatis). Header kasir, focus ring, safe-area, tab "Lainnya", sticky offline banner, spinner, dan tabel laporan juga dirapikan tanpa mengubah alur transaksi. |
| Jam transaksi komisi | Komisi Staff menampilkan jam pertama–terakhir per terapis dan panel rincian transaksi per jam (WITA, dari `created_at`). Kolom Jam juga ditambahkan ke Excel revenue/komisi harian. |
| Menu "Lainnya" | Panel tidak lagi memaksa satu kolom di layar sempit dan tidak dibatasi 75% tinggi layar. Di tablet panel diperlebar dengan 3 kolom (4 kolom untuk layar pendek) supaya 24 menu sekalipun muat; diuji 1599×999, 1280×800, 1024×600, 800×480, 390×844. Aturan `.kasir-more` yang duplikat juga dibersihkan. |
| Kualitas | 32 tes unit, cek render 35 halaman, lint tanpa warning, dan GitHub Actions (`.github/workflows/ci.yml`). |
| Android | APK 1.1 (`versionCode 2`) dibangun dari cabang `nothinggoodinheree-droid-android-receipt-printing`, berisi perbaikan di atas plus cetak Bluetooth, toast, dan tautan WhatsApp. |

## Menunggu keputusan atau tindakan owner

1. **Uji APK 1.1 di satu tablet** (login → transaksi → cetak struk) sebelum dipasang ke semua perangkat. Tidak ada perangkat/emulator saat build terakhir.
2. **Aturan lembur shift SP1**: `SHIFT_DEFS.SP1.endMin` bernilai `23:59`, padahal shift berakhir 14:00. Akibatnya lembur baru dihitung lewat tengah malam. Ini keputusan bisnis, bukan bug teknis.
3. **RLS ketat per peran**: perlu SSH tunnel ke VPS dan salinan database. Sebaiknya dipasang di jendela pemeliharaan.

## Celah yang masih ada

| Hal | Dampak | Catatan |
| --- | --- | --- |
| RLS masih longgar | Siapa pun yang punya sesi login bisa membaca/mengubah data lewat API | 21 kebijakan `using (true)` dan 18 `with check (true)` di file SQL. Pembatasan peran di UI bukan batas keamanan. |
| Belum ada baseline migrasi | SQL lama berisiko meregresi RPC jika dijalankan ulang | Lihat `supabase/README.md`. |
| Tidak ada antrean offline | Transaksi gagal saat internet mati | Keputusan sadar; sekarang hanya diberi pesan jujur. Antrean offline adalah pekerjaan tersendiri. |
| Toast hanya di APK | PWA memakai pesan inline | Port `notifications.js` + `ToastNotifications` perlu uji tampilan. |
| Bundle `exceljs` 938 kB | Ekspor Excel terasa lambat di HP kelas bawah | Kandidat untuk dipecah atau dimuat saat dibutuhkan. |
| Belum ada tes E2E | Alur kasir hanya diuji manual | Kandidat: Playwright untuk buat pesanan → bayar → struk. |

## Urutan yang disarankan

1. Uji APK 1.1 di satu tablet.
2. RLS per peran: siapkan di salinan database, uji dengan akun kasir dan order taker, pasang di jam sepi.
3. Baseline migrasi SQL: satu file idempoten yang aman dijalankan ulang.
4. Antrean offline, lalu port toast ke PWA, lalu pecah bundle Excel.
