-- ============================================================================
-- SEMBUNYIKAN THERAPIS DARI DAFTAR WA
--
-- Tujuannya: nama hilang dari DAFTAR OFF maupun DAFTAR ON di halaman
-- "Payment & List" (list WhatsApp), tanpa mengubah status, booking,
-- absensi, atau slip gaji. Semua data historis tetap utuh.
--
-- Kolom ini berdiri sendiri karena mengubah status jadi 'libur' punya efek
-- lain: orang ikut hilang dari Dashboard Terapis sehingga tidak bisa
-- dipilih lagi kalau ternyata masih dipakai sesekali.
-- ============================================================================

alter table therapists
  add column if not exists tampil_di_wa boolean not null default true;

comment on column therapists.tampil_di_wa is
  'false = nama disembunyikan dari daftar WA (off maupun on). Data lain tetap utuh.';

-- Semua orang tetap tampil sampai ada yang sengaja disembunyikan.
update therapists set tampil_di_wa = true where tampil_di_wa is null;

create index if not exists idx_therapists_tampil_di_wa
  on therapists (tampil_di_wa);

-- Ringkasan supaya mudah dicek tanpa perlu membuka aplikasi.
create or replace function ringkasan_tersembunyi_wa()
returns table (
  nama      text,
  id        uuid,
  status    text,
  outlet    text
)
language sql
stable
as $$
  select name, id, status::text, home_outlet_id
    from therapists
   where tampil_di_wa = false
   order by name;
$$;
