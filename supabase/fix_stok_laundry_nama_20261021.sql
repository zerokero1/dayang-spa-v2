-- ============================================================================
-- PERBAIKAN STOK LAUNDRY: NAMA BARANG YANG GIMPANG + OPNAME RERE
-- Dibuat  : 21/10/2026
-- Outlet  : Rere (RR) - utama, Drama (DR) & Dayang 2 (D2) - suspected
-- Tujuan  : 1. Menyamakan nama barang dengan treatment_consumables supaya
--              stok laundry benar-benar berkurang tiap ada booking.
--           2. Mencatat opname fisik laundry Rere ke dalam log.
--
-- MASALAH YANG DISELESAIKAN (hasil pemeriksaan data live 21/10/2026)
--
--   1. RERe (RR) - stok laundry tidak pernah berkurang sama sekali.
--      RPC consume_treatment_products mencocokkan barang dengan:
--          join inventory i
--            on i.outlet_id = p_outlet_id
--           and lower(i.name) = lower(c.item_name)
--      treatment_consumables menulis 'Face Cradle', 'Hole Sheet',
--      'Single Sheet'. Yang tersimpan di outlet Rere:
--          'Face credle'  (huruf 'c' dobel)  -> tidak cocok
--          'Hool sheet'   (e <-> o tertukar)  -> tidak cocok
--          'Single Sheet' -> TIDAK ADA sama sekali
--      Akibatnya join itu mengembalikan 0 baris, sehingga 61 booking
--      full body di Rere sejak 13/10/2026 tidak memotong stok apa pun.
--      Bukti: seluruh item laundry di Rere punya total_out = 0, sedangkan
--      outlet lain mencatat ratusan (D1 186, DR 338, DP 113, D2 102, Y 73).
--
--   2. DRama (DR) punya 'Face Cradle' (stok 0, hasil seed 30/09) dan
--      'Face creadle' (stok 10, hasil opname 13/10). Konsumsi selama ini
--      selalu kena ke baris stok 0, jadi stok 10 tidak pernah turun.
--
--   3. Dayang 2 (D2) punya 'singgel sheet' (stok 4) sehingga Single Sheet
--      tidak pernah ikut terpotong.
--
--   4. Kolom 'unit' di 24 baris berisi ANGKA, bukan satuan. Contohnya
--      'Hool sheet' unit '47', 'Body cover' unit '67'. Tampilan di aplikasi
--      jadi "Hool sheet (12 47)" dan laporan ikut berantakan.
--
-- CATATAN PENTING
--   - Script ini sudah DIJALANKAN di server pada 21/10/2026. Salinan
--     sebelum perubahan ada di arsip_inventory_rr_opname_20261021,
--     arsip_logs_rr_opname_20261021, dan arsip_inventory_perbaiki_nama_20261021.
--   - Bagian 3 (opname) TIDAK aman diulang: log dengan catatan yang sama
--     sudah ada, jadi qty-nya akan terpotong dua kali.
--   - 'Single Sheet' sengaja tidak dibuat di Rere dan Yulis. Opname fisik
--     tidak menemukan barang itu, jadi kedua outlet memang tidak menyimpan
--     single sheet. Kalau ternyata ada, tambahkan lewat halaman Stok.
--
-- CARA PAKAI
--   1. Jalankan Bagian 1 (backup) dan Bagian 2 (cek).
--   2. Kalau angkanya sesuai, jalankan Bagian 3 lalu Bagian 4.
--   3. Terakhir jalankan Bagian 5 (verifikasi) dan Bagian 6 (pemeriksaan rutin).
-- ============================================================================


-- ============================================================================
-- BAGIAN 1 - BACKUP
-- ============================================================================
create table if not exists arsip_inventory_rr_opname_20261021 as
  select * from inventory where outlet_id = 'RR';

create table if not exists arsip_logs_rr_opname_20261021 as
  select l.* from inventory_logs l
  join inventory i on i.id = l.item_id
  where i.outlet_id = 'RR';

create table if not exists arsip_inventory_perbaiki_nama_20261021 as
  select * from inventory;


-- ============================================================================
-- BAGIAN 2 - CEK DULU (hanya SELECT)
-- ============================================================================

-- 2a. Barang consumable yang tidak punya baris di outletnya.
--     Ini penyebab stok tidak pernah berkurang.
select distinct
  o.outlet_id,
  c.item_name,
  (select count(*) from inventory i
    where i.outlet_id = o.outlet_id and lower(i.name) = lower(c.item_name)) as baris_cocok
from (select distinct outlet_id from inventory) o
cross join (select distinct item_name from treatment_consumables) c
where c.item_name in ('Face Cradle', 'Hole Sheet', 'Single Sheet')
  and not exists (
    select 1 from inventory i
    where i.outlet_id = o.outlet_id and lower(i.name) = lower(c.item_name)
  )
order by o.outlet_id, c.item_name;

-- 2b. Nama yang mirip consumable tapi tidak persis (indikasi salah ketik).
select
  i.outlet_id,
  i.name          as nama_tersimpan,
  i.stock,
  c.item_name     as nama_consumable
from inventory i
join (select distinct item_name from treatment_consumables) c
  on lower(i.name) <> lower(c.item_name)
 and (lower(i.name) like '%' || left(lower(c.item_name), 4) || '%'
   or lower(c.item_name) like '%' || left(lower(i.name), 4) || '%')
where i.category = 'Laundry'
order by i.outlet_id, i.name;

-- 2c. Item laundry yang total_out-nya 0 padahal outletnya aktif.
select
  i.outlet_id,
  i.name,
  i.stock,
  (select count(*) from bookings b
    where b.outlet_id = i.outlet_id and b.status <> 'batal') as booking_di_outlet
from inventory i
where i.category = 'Laundry'
  and not exists (
    select 1 from inventory_logs l
    where l.item_id = i.id and l.type = 'out'
  )
order by i.outlet_id, i.name;

-- 2d. Kolom unit yang isinya bukan satuan.
select outlet_id, name, unit, stock
from inventory
where unit !~ '^(pcs|lembar|botol|lusin|kg|box)$'
order by outlet_id, name;


-- ============================================================================
-- BAGIAN 3 - PROSES
-- ============================================================================
begin;

-- 3a. Rere: nama disamakan dengan treatment_consumables.
--     Tidak ada baris 'Face Cradle' / 'Hole Sheet' di Rere, jadi tidak
--     bentrok dengan unique index (outlet_id, lower(name)).
update inventory set name = 'Face Cradle', unit = 'pcs'
where outlet_id = 'RR' and name = 'Face credle';

update inventory set name = 'Hole Sheet', unit = 'lembar'
where outlet_id = 'RR' and name = 'Hool sheet';

-- 3b. Dayang 2: 'singgel sheet' -> 'Single Sheet'.
update inventory set name = 'Single Sheet', unit = 'lembar'
where outlet_id = 'D2' and name = 'singgel sheet';

-- 3c. Drama: baris stok 0 yang resilient dari seed 30/09 diberi nama
--     arsip supaya tidak ikut cocok, baris yang berisi 10 yang jadi
--     nama resmi. Baris stok 0 tidak dihapus karena 338 log 'out'
--     masih menunjuk ke sana dan riwayat itu tidak boleh hilang.
update inventory set name = 'Face Cradle (riwayat)'
where outlet_id = 'DR' and name = 'Face Cradle' and stock = 0;

update inventory set name = 'Face Cradle', unit = 'pcs'
where outlet_id = 'DR' and name = 'Face creadle';

-- 3d. Kolom unit yang berisi angka dibenahi jadi satuan yang benar.
--     'lembar' untuk barang seperti sheet, 'pcs' untuk sisanya.
update inventory set unit = 'pcs'
where unit !~ '^(pcs|lembar|botol|lusin|kg|box)$'
  and lower(name) not like '%sheet%';

update inventory set unit = 'lembar'
where unit !~ '^(pcs|lembar|botol|lusin|kg|box)$'
  and lower(name) like '%sheet%';

-- 3e. OPNAME LAUNDRY RERE.
--     Angka dari hitungan fisik ruang laundry Rere tanggal 21/10/2026.
--     Selisih dicatat sebagai 'in' atau 'out' supaya jejaknya tetap bisa
--     diaudit, bukan hanya mengubah angka stok diam-diam.
--
--     PENTING: hanya jalan sekali. Kalau diulang, log dengan catatan yang
--     sama akan terpotong dua kali.
insert into inventory_logs (outlet_id, item_id, type, qty, note, created_at)
select
  'RR',
  i.id,
  case when v.target > i.stock then 'in'::inventory_log_type
       else 'out'::inventory_log_type end,
  abs(v.target - i.stock),
  'Opname laundry Rere 21 Okt 2026',
  now()
from (values
  ('Hole Sheet',    18),
  ('Body cover',    18),
  ('Face Cradle',    4),
  ('Meni towel',     3),
  ('Pedi towel',     3),
  ('Hand towel',    10),
  ('Face towel',     3),
  ('Cool towel',     7),
  ('Warm towel',     1)
) as v(nama, target)
join inventory i
  on i.outlet_id = 'RR' and i.name = v.nama
where v.target <> i.stock
  and not exists (
    select 1 from inventory_logs l
    where l.item_id = i.id and l.note = 'Opname laundry Rere 21 Okt 2026'
  );

-- 3f. Terapkan hasil opname ke stok.
update inventory i
   set stock = greatest(i.stock + coalesce((
         select case when l.type = 'in'::inventory_log_type then l.qty else -l.qty end
         from inventory_logs l
         where l.item_id = i.id and l.note = 'Opname laundry Rere 21 Okt 2026'
       ), 0), 0)
where i.outlet_id = 'RR'
  and exists (
    select 1 from inventory_logs l
    where l.item_id = i.id and l.note = 'Opname laundry Rere 21 Okt 2026'
  );

commit;


-- ============================================================================
-- BAGIAN 4 - YANG SUDAH DILAKUKAN 21/10/2026 (catatan hasil)
-- ============================================================================
-- Stok laundry Rere setelah opname:
--   Hole Sheet    18 lembar     Face towel   3 pcs
--   Body cover    18 pcs        Hand gloves  1 pcs
--   Face Cradle    4 pcs        Hand towel  10 pcs
--   Meni towel     3 pcs        Keset        0 pcs
--   Pedi towel     3 pcs        Tutup mata   1 pcs
--   Cool towel     7 pcs        Warm towel   1 pcs
--   Bath towel     1 pcs
--
-- Log opname Rere (9 baris):
--   in  6  Body cover    | out 1  Meni towel
--   in  5  Hand towel    | out 6  Pedi towel
--   in  1  Face towel    | in  7  Cool towel
--   in  1  Warm towel    | in  6  Hole Sheet
--                            | in  1  Face Cradle


-- ============================================================================
-- BAGIAN 5 - VERIFIKASI
-- Semua query di bawah WAJIB mengembalikan 0 baris.
-- ============================================================================

-- 5a. Consumable yang tidak punya baris di outletnya.
select distinct o.outlet_id, c.item_name
from (select distinct outlet_id from inventory) o
cross join (select distinct item_name from treatment_consumables) c
where c.item_name in ('Face Cradle', 'Hole Sheet', 'Single Sheet')
  and not exists (
    select 1 from inventory i
    where i.outlet_id = o.outlet_id and lower(i.name) = lower(c.item_name)
  )
order by o.outlet_id, c.item_name;
-- CATATAN: Rere dan Yulis memang tidak menyimpan Single Sheet (hasil opname
-- tidak menemukannya), jadi 2 baris ini memang muncul. Itu wajar.

-- 5b. Barang kembar di satu outlet.
select outlet_id, lower(name) as nama, count(*)
from inventory
group by outlet_id, lower(name)
having count(*) > 1;

-- 5c. Kolom unit yang bukan satuan.
select outlet_id, name, unit from inventory
where unit !~ '^(pcs|lembar|botol|lusin|kg|box)$';

-- 5d. Stok laundry Rere sekarang.
select name, unit, stock
from inventory
where outlet_id = 'RR' and category = 'Laundry'
order by name;

-- 5e. Pastikan tidak ada log yang menunjuk item yang sudah dihapus.
select count(*) as log_yatim
from inventory_logs l
where not exists (select 1 from inventory i where i.id = l.item_id);


-- ============================================================================
-- BAGIAN 6 - PEMERIKSAAN RUTIN
-- Jalankan sebelum tutup bulan. Kalau ada baris, ada barang yang disalah
-- ketik lagi dan stoknya diam-diam tidak berkurang.
-- ============================================================================
select
  i.outlet_id,
  i.name         as nama_tersimpan,
  i.stock,
  (select count(*) from bookings b
    where b.outlet_id = i.outlet_id and b.status <> 'batal') as booking_di_outlet
from inventory i
where i.category = 'Laundry'
  and i.stock > 0
  and not exists (
    select 1 from inventory_logs l
    where l.item_id = i.id and l.type = 'out'
  )
order by i.outlet_id, i.name;
