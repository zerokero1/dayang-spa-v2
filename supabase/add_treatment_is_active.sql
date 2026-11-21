-- Kelola Treatment: soft delete / nonaktifkan treatment.
--
-- Jalankan lewat: node sql-jalankan.mjs supabase/add_treatment_is_active.sql
-- (Postgres self-host di VPS). Bukan lewat Supabase cloud SQL Editor.
--
-- Aman dijalankan berulang (idempoten). Jangan jalankan schema.sql lama.
-- Treatment TIDAK dihapus dari tabel karena booking, reservasi, dan struk
-- lama mereferensikannya. Menonaktifkan cukup membuatnya hilang dari pilihan
-- kasir/reservasi lewat filter di src/lib/treatmentService.js.

alter table public.treatments
  add column if not exists is_active boolean not null default true;

comment on column public.treatments.is_active is
  'false = treatment dinonaktifkan; baris tetap disimpan agar riwayat transaksi terbaca';

-- `add column ... not null default true` sudah mengisi baris lama di PostgreSQL.
-- Jaga-jaga kalau kolom sudah ada dengan nilai null dari migrasi sebelumnya.
update public.treatments set is_active = true where is_active is null;
