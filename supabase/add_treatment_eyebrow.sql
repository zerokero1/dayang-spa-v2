-- ============================================================
-- INSERT TREATMENT: Eyebrow 80K
--   - Kategori  : Hair Treatment (cocok untuk eyebrow; mudah
--                 dipindah ke kategori lain di tabel treatments)
--   - Harga     : 80.000 (Rp)
--   - Durasi    : 30 menit (dapat diubah kapan pun di tabel
--                 treatments -> kolom duration_minutes)
--   - Komisi    : 10%
--   - Tanpa minyak (uses_oil = false)
--
-- JALANKAN file ini di Supabase SQL Editor.
-- Gunakan ON CONFLICT DO NOTHING supaya tidak dobel jika dijalankan ulang.
-- ============================================================

insert into treatments (name, price, category, duration_minutes, commission_percent, uses_oil)
select 'Eyebrow', 80000, 'Hair Treatment', 30, 10, false
where not exists (select 1 from treatments where name = 'Eyebrow');
