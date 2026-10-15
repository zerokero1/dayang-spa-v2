-- ============================================================================
-- RAPIKAN NAMA BARANG INVENTORY
-- Dibuat  : 12/10/2026
-- Tujuan  : buang spasi ganda / spasi di akhir nama barang, lalu gabungkan
--           barang kembar jadi satu baris.
--
-- MASALAH YANG DISELESAIKAN (hasil pemeriksaan data live 12/10/2026)
--   1. 22 dari 125 baris nama berakhiran spasi atau punya spasi ganda,
--      contoh 'Body cover ', 'Hand towel ', 'mn  towel'. Kasir mudah salah
--      pilih dan laporan terlihat berantakan.
--   2. Outlet D2 punya kembar: 'hand towel' dan 'hand towel '.
--
-- KENAPA KEMBARRAN HARUS DIGABUNGKAN, BUKAN CUKUP DIRAPIKAN
--   RPC consume_treatment_products mencocokkan barang dengan:
--       join inventory i
--         on i.outlet_id = p_outlet_id
--        and lower(i.name) = lower(c.item_name)
--   Kalau satu outlet punya DUA baris dengan nama sama, join itu mengembalikan
--   dua baris, sehingga stok terpotong DUA KALI untuk satu treatment dan
--   inventory_logs jadi dua baris. Jadi nama kembar wajib digabung.
--
-- YANG TERJADI SETELAH DIJALANKAN
--   nama dirapikan          : 22 baris
--   baris digabung         : 1  (D2 'hand towel' + 'hand towel ', stok 0 + 0)
--   log yang dipindah       : 2 baris log milik 'hand towel' (yang dipertahankan)
--   treatment_consumables   : tidak berubah, tidak ada nama perlu dirapikan
--
-- CATATAN PENTING
--   Script ini belum pernah dijalankan di server. Jalankan Bagian 2 lebih dulu
--   dan cocokkan angkanya dengan daftar di atas sebelum menjalankan Bagian 3.
--
-- CARA PAKAI
--   1. Jalankan Bagian 1 (bawaan) lalu Bagian 2 (cek).
--   2. Kalau hasilnya sesuai, jalankan Bagian 3 (proses).
--   3. Terakhir jalankan Bagian 4 (pencegahan) dan Bagian 5 (verifikasi).
-- ============================================================================


-- ============================================================================
-- BAGIAN 1 - BAWAAN
-- Dijalankan sekali. Boleh diulang, aman karena memakai if not exists.
-- ============================================================================
create table if not exists inventory_backup_20261012 as
  select * from inventory;

create table if not exists inventory_logs_backup_20261012 as
  select * from inventory_logs;

comment on table inventory_backup_20261012 is
  'Salinan tabel inventory sebelum nama barang dirapikan (12/10/2026).';
comment on table inventory_logs_backup_20261012 is
  'Salinan tabel inventory_logs sebelum nama barang dirapikan (12/10/2026).';


-- ============================================================================
-- BAGIAN 2 - CEK DULU (hanya SELECT, tidak mengubah apa pun)
-- ============================================================================

-- 2a. Berapa baris yang akan berubah.
select
  count(*)                                    as total_baris,
  count(*) filter (
    where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))
  )                                           as akan_dirapikan
from inventory;

-- 2b. Daftar baris yang akan berubah beserta nama barunya.
select
  outlet_id,
  name                                        as nama_lama,
  btrim(regexp_replace(name, '\s+', ' ', 'g'))  as nama_baru,
  stock,
  unit,
  category
from inventory
where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))
order by outlet_id, nama_lama;

-- 2c. Barang yang akan jadi kembar SETELAH dirapikan.
--     Kalau kosong, tidak ada penggabungan yang perlu dilakukan.
--     Kalau tidak kosong, periksa rincian_stok: angkanya harus masuk akal.
select
  outlet_id,
  btrim(regexp_replace(name, '\s+', ' ', 'g'))  as nama_setelah_rapikan,
  count(*)                                     as jumlah_baris,
  string_agg(id::text, ', ' order by created_at)          as id_dalam_kelompok,
  string_agg(stock::text, ' + ' order by created_at)      as rincian_stok,
  sum(stock)                                   as total_stok
from inventory
group by outlet_id, btrim(regexp_replace(name, '\s+', ' ', 'g'))
having count(*) > 1
order by outlet_id, nama_setelah_rapikan;

-- 2d. Barang yang dipakai treatment harus tetap punya baris di outletnya.
--     Kalau muncul di sini, barangnya belum terdaftar - buat dulu di halaman Stok.
select distinct
  c.item_name,
  t.name                                       as nama_treatment
from treatment_consumables c
join treatments t on t.id = c.treatment_id
where not exists (
  select 1 from inventory i
  where lower(i.name) = lower(btrim(regexp_replace(c.item_name, '\s+', ' ', 'g')))
)
order by c.item_name;

-- 2e. Berapa nama treatment_consumables yang perlu dirapikan.
select count(*) as perlu_dirapikan
from treatment_consumables
where item_name <> btrim(regexp_replace(item_name, '\s+', ' ', 'g'));


-- ============================================================================
-- BAGIAN 3 - PROSES
--
-- URUTAN WAJIB: gabungkan dulu, baru rapikan. Alasannya, di server sudah ada
-- unique index (outlet_id, lower(name)). Kalau nama dirapikan lebih dulu,
-- 'hand towel ' berubah jadi 'hand towel' dan langsung bentrok dengan baris
-- yang sudah ada - Postgres akan menolak dengan:
--     duplicate key value violates unique constraint "inventory_outlet_name_uniq"
-- Karena itu kelompok kembar dihitung dari BENTUK NAMA SETELAH dirapikan
-- (lower dari hasil trim), tapi nama di database sendiri baru ditulis setelah
-- baris kembarnya dibuang.
-- ============================================================================
begin;

-- 3a. Susun rencana penggabungan memakai nama yang SUDAH dinormalisasi.
--     Baris yang dipertahankan adalah yang punya riwayat log paling banyak
--     supaya laporan riwayat tetap utuh; kalau sama, yang paling lama dibuat.
--     Rencana disimpan di tabel sementara supaya bisa dipakai statement
--     berikutnya - WITH hanya berlaku untuk satu statement, bukan statement
--     berikutnya.
create temporary table _plan_gabung on commit drop as
select
  outlet_id,
  lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))              as kunci,
  (array_agg(id order by
      (select count(*) from inventory_logs l where l.item_id = inventory.id) desc,
      created_at asc,
      id asc
  ))[1]                                                          as id_selamat,
  array_agg(id order by
      (select count(*) from inventory_logs l where l.item_id = inventory.id) desc,
      created_at asc,
      id asc
  )                                                             as semua_id
from inventory
group by outlet_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
having count(*) > 1;

-- 3b. Jumlahkan stok baris yang akan dihapus ke baris yang dipertahankan.
update inventory i
   set stock = i.stock + coalesce(p.stok_pindah, 0)
  from (
    select p.id_selamat, sum(s.stock) as stok_pindah
    from _plan_gabung p
    join inventory s on s.id = any(p.semua_id) and s.id <> p.id_selamat
    group by p.id_selamat
  ) p
 where i.id = p.id_selamat;

-- 3c. Pindahkan riwayat log milik baris yang dihapus ke baris selamat.
--     Ini menjaga supaya laporan "barang masuk/keluar" tetap utuh.
update inventory_logs l
   set item_id = p.id_selamat
  from _plan_gabung p
 where l.item_id = any(p.semua_id)
   and l.item_id <> p.id_selamat;

-- 3d. Hapus baris kembar yang tidak dipertahankan.
delete from inventory i
 using _plan_gabung p
 where i.id = any(p.semua_id)
   and i.id <> p.id_selamat;

-- 3e. RapiKAN nama barang.
--     Perbandingan memakai nama yang sudah dirapikan supaya UPDATE-nya benar-benar
--     terjadi (kalau tidak, Postgres menganggap tidak ada yang berubah).
update inventory
   set name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
 where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));

-- 3f. RapiKAN juga nama pada treatment_consumables supaya pencocokan
--     lower(name) tetap berlaku. Dulu dicek: tidak ada baris yang perlu diubah
--     dan tidak ada bentrok primary key, jadi ini hanya penjaga.
update treatment_consumables
   set item_name = btrim(regexp_replace(item_name, '\s+', ' ', 'g'))
 where item_name <> btrim(regexp_replace(item_name, '\s+', ' ', 'g'));

commit;

-- 3g. Kalau tabel sementara masih tertinggal (mis. session produksi yang
--     menjalankan commit tanpa on commit drop), bersihkan manual:
--     drop table if exists _plan_gabung;


-- ============================================================================
-- BAGIAN 4 - PENCEGANG
-- Tanpa bagian ini, masalah yang sama akan muncul lagi minggu depan.
-- ============================================================================

-- 4a. Trigger yang selalu merapikan nama sebelum disimpan. Kasir yang mengetik
--     "Body cover " tidak lagi membuat kembar.
create or replace function rapikan_nama_barang()
returns trigger
language plpgsql
as $$
begin
  if new.name is not null then
    new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rapikan_nama_barang on inventory;
create trigger trg_rapikan_nama_barang
  before insert or update of name on inventory
  for each row execute function rapikan_nama_barang();

-- Pemicu yang sama untuk treatment_consumables.
create or replace function rapikan_nama_kebutuhan()
returns trigger
language plpgsql
as $$
begin
  if new.item_name is not null then
    new.item_name := btrim(regexp_replace(new.item_name, '\s+', ' ', 'g'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rapikan_nama_kebutuhan on treatment_consumables;
create trigger trg_rapikan_nama_kebutuhan
  before insert or update of item_name on treatment_consumables
  for each row execute function rapikan_nama_kebutuhan();

-- 4b. Index unik per outlet per nama. Inilah yang benar-benar menolak kembar:
--     trigger merapikan, index menolak kalau tetap ada kembar.
--     Memakai lower(name) supaya 'Face Cradle' dan 'face cradle' tetap satu.
create unique index if not exists inventory_outlet_name_uniq
  on inventory (outlet_id, lower(name));


-- ============================================================================
-- BAGIAN 5 - VERIFIKASI
-- 5a sampai 5c WAJIB mengembalikan 0 baris.
-- ============================================================================

-- 5a. Tidak boleh ada nama dengan spasi ganda atau spasi di akhir.
select outlet_id, name
from inventory
where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));

-- 5b. Tidak boleh ada barang kembar di satu outlet.
select outlet_id, lower(name) as nama, count(*)
from inventory
group by outlet_id, lower(name)
having count(*) > 1;

-- 5c. Setiap barang yang dipakai treatment harus punya baris di outletnya.
select c.item_name, t.name as nama_treatment
from treatment_consumables c
join treatments t on t.id = c.treatment_id
where not exists (
  select 1 from inventory i where lower(i.name) = lower(c.item_name)
);

-- 5d. Jumlah baris sekarang. Dulu 125, harus jadi 124 setelah 1 penggabungan.
select count(*) as baris_sekarang from inventory;

-- 5e. Bandingkan dengan backup: yang berubah hanya kolom nama, dan stock
--     hanya berubah pada baris hasil penggabungan.
select
  i.outlet_id,
  b.id is null                                  as baris_baru,
  b.name                                        as nama_di_backup,
  i.name                                        as nama_sekarang,
  b.stock                                       as stok_backup,
  i.stock                                       as stok_sekarang,
  b.stock is distinct from i.stock              as stok_berubah
from inventory i
left join inventory_backup_20261012 b on b.id = i.id
where b.id is null
   or b.name is distinct from i.name
   or b.stock is distinct from i.stock
order by i.outlet_id, i.name;

-- 5f. Pastikan tidak ada log yang masih menunjuk item_id yang sudah dihapus.
select count(*) as log_yatim
from inventory_logs l
where not exists (select 1 from inventory i where i.id = l.item_id);