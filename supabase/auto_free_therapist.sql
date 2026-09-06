-- ============================================================
-- AUTO FREE TERAPIS
-- Terapis otomatis kembali ke status 'free' begitu waktu treatment
-- (end_at) sudah lewat — tanpa harus menekan tombol Selesai.
--
-- Aturan:
--   * Hanya berlaku untuk terapis berstatus 'ambil_tamu'.
--   * Efektif ASAL semua booking 'berjalan'-nya sudah LUNAS (paid = true).
--     Kalau masih ada yang belum bayar, terapis TETAP tampil di
--     Payment & List sampai dilunasi (agar tagihan tidak hilang).
--   * Booking 'berjalan' yang waktu-nya habis diakhiri jadi 'selesai'.
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

  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and t.end_at is not null
      and t.end_at <= v_now
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id
          and b.status = 'berjalan'
          and coalesce(b.paid, false) = false
      )
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

  return v_done;
end;
$fn$;

grant execute on function public.auto_free_expired_therapists() to authenticated;