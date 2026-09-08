-- ============================================================
-- RESERVASI BARU — hanya kategori + jam + terapis
-- Kolom `category` dipakai sebagai "janji kategori". Saat jam
-- booking mendekat, kasir mengisi treatment & minyak yang persis
-- lewat tombol "Isi Treatment" (memakai treatment kategori tsb).
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

alter table reservations add column if not exists category text;