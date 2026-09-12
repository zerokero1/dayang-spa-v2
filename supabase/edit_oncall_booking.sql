-- ============================================================
-- EDIT ONCALL BOOKING
-- Mengupdate sebuah booking oncall: terapis, paket/nama, durasi,
-- harga, komisi terapis, komisi hotel, nama tamu, metode bayar.
--
-- JALANKAN sekali di Supabase SQL Editor (CREATE OR REPLACE).
-- ============================================================

create or replace function public.edit_oncall_booking(
  p_booking_id uuid,
  p_therapist_id uuid,
  p_therapist_name text,
  p_package_name text,
  p_duration_minutes integer,
  p_price numeric,
  p_commission_percent numeric,
  p_hotel_commission numeric,
  p_customer_name text,
  p_payment_method text
) returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1 from bookings
    where id = p_booking_id and booking_source = 'oncall'
  ) then
    raise exception 'Booking oncall tidak ditemukan';
  end if;

  update bookings
     set therapist_id = p_therapist_id,
         therapist_name = coalesce(p_therapist_name, therapist_name),
         treatment_name = coalesce(p_package_name, treatment_name),
         duration_minutes = coalesce(p_duration_minutes, duration_minutes),
         treatment_price = p_price,
         original_price = null,
         commission_percent = p_commission_percent,
         commission_amount = round(p_commission_percent / 100.0 * p_price),
         hotel_commission = p_hotel_commission,
         customer_name = coalesce(p_customer_name, ''),
         payment_method = p_payment_method
   where id = p_booking_id and booking_source = 'oncall';
end;
$function$;