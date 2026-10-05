-- ============================================================
-- Produk satu jenis: Foot Cream, FM, Aloevera Cream
--
-- Produk ini sebenarnya hanya ada satu jenis, tidak punya varian
-- Kecil/Besar. Tapi selama ini kasir tetap bisa memilihnya, sehingga stok
-- terpecah jadi dua angka untuk produk yang sama. Contoh di outlet yang
-- sama: Foot Cream Besar 289 booking vs Kecil 113 booking.
--
-- Script ini:
--   1. Menjumlahkan stok Kecil + Besar jadi satu baris (size = '-')
--   2. Membuang baris ukuran yang sekarang nol
--   3. Menyamakan ukuran di booking & reservasi lama jadi '-'
--
-- Kenapa size = '-' dan bukan NULL:
--   oil_inventory.size bagian dari PRIMARY KEY jadi tidak boleh NULL, dan
--   RPC create_booking hanya memotong stok kalau size IS NOT NULL. Kalau
--   diisi NULL, stok akan diam-diam tidak berkurang tanpa pesan error.
--
-- AMAN DIJALANKAN ULANG: semua langkah idempotent.
-- ============================================================

begin;

-- 1. Jadwalkan baris '-' berisi total dari kedua ukuran, hanya untuk produk
--    satu jenis. where not exists supaya tidak menimpa baris '-' yang sudah ada.
insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
select
  o.outlet_id,
  o.oil_type,
  '-',
  coalesce(sum(o.stock), 0),
  'botol'
from oil_inventory o
where o.oil_type in ('Foot Cream', 'FM', 'Aloevera Cream')
  and o.size in ('Kecil', 'Besar')
  and not exists (
    select 1 from oil_inventory x
    where x.outlet_id = o.outlet_id
      and x.oil_type = o.oil_type
      and x.size = '-'
  )
group by o.outlet_id, o.oil_type;

-- 2. Buang baris Kecil/Besar yang sekarang sudah digabung (tidak ada lagi yang
--    memakai ukurannya). Baris yang stoknya nol ikut dibuang supaya tidak
--    muncul sebagai kartu kosong di halaman Stok Minyak.
delete from oil_inventory
where oil_type in ('Foot Cream', 'FM', 'Aloevera Cream')
  and size in ('Kecil', 'Besar');

-- 3. Samakan ukuran di booking lama supaya laporan produksi tidak menghitung
--    1.148 baris dengan 10ml atau 30ml secara acak.
update bookings
set oil_size = '-'
where oil_type in ('Foot Cream', 'FM', 'Aloevera Cream')
  and oil_size is distinct from '-';

-- 4. Reservasi juga menyimpan ukuran, dan jadi booking saat check-in. Samakan
--    supaya tidak memunculkan "Foot Cream (-)" saat reservasi ini dipakai.
update reservations
set oil_size = '-'
where oil_type in ('Foot Cream', 'FM', 'Aloevera Cream')
  and oil_size is distinct from '-';

commit;