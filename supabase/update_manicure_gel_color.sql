-- ============================================================
-- UPDATE TREATMENT: Manicure + Gel Color -> Rp 250.000
--   - Nama  : Manicure + Gel Color (sebelumnya Rp 150.000)
--   - Harga : 250.000 (Rp)
--
-- JALANKAN file ini di Supabase SQL Editor.
-- Hanya mengubah bila treatment memang ada & harganya belum 250K
-- (aman jika dijalankan ulang).
-- ============================================================

update treatments
set price = 250000
where name = 'Manicure + Gel Color'
  and coalesce(price, 0) <> 250000;
