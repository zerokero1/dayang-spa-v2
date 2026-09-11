-- ============================================================
-- KOREKSI PEMBAYARAN (khusus Office)
-- Mengubah status bayar & metode pembayaran sebuah booking:
--   * p_paid = true  -> tandai LUNAS (metode cash/cardless)
--   * p_paid = false -> balikkan jadi BELUM BAYAR
-- Untuk mengoreksi kasir yang lupa menandai bayar (antilupa),
-- atau salah metode (cash/cardless).
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

create or replace function koreksi_pembayaran(
  p_booking_id uuid,
  p_paid boolean,
  p_payment_method text default null
) returns void
language plpgsql
as $fn$
begin
  update bookings
     set paid = p_paid,
         payment_method = case when p_paid then coalesce(p_payment_method, payment_method) else null end
   where id = p_booking_id;

  if not found then
    raise exception 'Booking tidak ditemukan';
  end if;

  -- Jaga agar kartu Status Terapis ikut sinkron kalau terapisnya sedang ambil tamu.
  update therapists
     set current_paid = p_paid,
         current_payment_method = case when p_paid then coalesce(p_payment_method, current_payment_method) else null end
   where current_booking_ids is not null
     and current_booking_ids @> jsonb_build_array(p_booking_id::text);
end;
$fn$;

grant execute on function public.koreksi_pembayaran(uuid, boolean, text) to authenticated;