-- ============================================================
-- AUTO UNBLOCK TERAPIS
-- Terapis otomatis kembali ke status 'free' begitu waktu treatment
-- (end_at) sudah lewat — tanpa harus menekan tombol Selesai.
--
-- Penting:
--   * HANYA status terapis yang di-unblock (free). TRANSANSI/BOOKING
--     TIDAK diubah — tetap 'berjalan' sampai kasir menutup manual
--     (Selesai / Batal / Batal Sebagian).
--   * Terapis 'ambil_tamu' yang tidak punya booking 'berjalan' sama
--     sekali (status nyangkut lama) dipaksa bersihkan jadi free.
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

  -- (1) Terapis yang waktu treatment-nya sudah lewat -> langsung free.
  --     Booking TIDAK disentuh (tetap 'berjalan').
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and t.end_at is not null
      and t.end_at <= v_now
  loop
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