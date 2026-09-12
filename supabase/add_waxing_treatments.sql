-- ============================================================
-- WAXING TREATMENTS
--   1. Ubah "Eyebrow" -> "Waxing Eyebrow" + kategori Waxing
--   2. Tambah "Upper Lip" 80.000 (Waxing)
--   3. Tambah "Chin" 100.000 (Waxing)
-- Semua tanpa minyak (uses_oil = false), durasi 30 menit, komisi 10%.
--
-- JALANKAN file ini di Supabase SQL Editor.
-- Idempotent: aman dijalankan ulang.
-- ============================================================

-- 1) Rename + pindah kategori
update treatments
   set name = 'Waxing Eyebrow', category = 'Waxing'
 where lower(name) = 'eyebrow';

-- 2) Upper Lip 80.000
insert into treatments (name, price, category, duration_minutes, commission_percent, uses_oil)
select 'Upper Lip', 80000, 'Waxing', 30, 10, false
where not exists (select 1 from treatments where lower(name) = 'upper lip');

-- 3) Chin 100.000
insert into treatments (name, price, category, duration_minutes, commission_percent, uses_oil)
select 'Chin', 100000, 'Waxing', 30, 10, false
where not exists (select 1 from treatments where lower(name) = 'chin');