-- ============================================================
-- AUTO FREE TERAPIS
-- Terapis otomatis kembali ke status 'free' begitu waktu treatment
-- (end_at) sudah lewat — tanpa harus menekan tombol Selesai.
--
-- Aturan:
--   * Hanya berlaku untuk terapis berstatus 'ambil_tamu'.
--   * Tanpa syarat sudah-bayar: begitu waktu habis -> booking
--     'berjalan' diakhiri jadi 'selesai' dan terapis langsung free.
--     Tagihan yang belum bayar tetap terlihat di seksi "Belum Bayar"
--     pada halaman Payment & List (dibuat dari booking paid=false).
--   * Terapis 'ambil_tamu' yang tidak punya booking 'berjalan'
--     sama sekali (status nyangkut lama) dipaksa bersihkan jadi free.
--
-- Dijalankan otomatis oleh web app setiap 30 detik.
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

create or replace function auto_free_expired_therapists()
returns int
language plpgsql
as $fn$
declare
  v_now bigint;
  r record;
  v_done int := 0;
begin
  v_now := (extract(epoch from now()) * 1000)::bigint;

  -- (1) Terapis yang waktu treatment-nya sudah lewat -> akhiri booking
  --     yang sudah lewat + kembalikan ke free (tanpa syarat lunas).
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and t.end_at is not null
      and t.end_at <= v_now
  loop
    update bookings
       set status = 'selesai',
           completed_at = now()
     where therapist_id = r.tid
       and status = 'berjalan'
       and end_at is not null
       and end_at <= v_now;

    perform clear_therapist_session(r.tid);
    v_done := v_done + 1;
  end loop;

  -- (2) Terapis 'ambil_tamu' yang tidak punya booking 'berjalan' sama sekali
  --     (status nyangkut dari sisa lama) -> paksa bersihkan jadi free.
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id and b.status = 'berjalan'
      )
  loop
    perform clear_therapist_session(r.tid);
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$fn$;

grant execute on function public.auto_free_expired_therapists() to authenticated;