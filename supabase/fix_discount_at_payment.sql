-- ============================================================
-- UPDATE RPC: mark_booking_paid
-- Menambahkan dukungan DISKON saat menandai lunas.
--   - p_new_price      : harga yang dibayar setelah diskon (null = tanpa diskon)
--   - p_original_price : harga sebelum diskon (disimpan untuk laporan)
--   - komisi dihitung ulang dari harga baru
--   - current_price terapis diagregasi ulang dari semua booking aktif
--
-- JALANKAN file ini di Supabase SQL Editor.
-- ============================================================

create or replace function mark_booking_paid(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid,
  p_payment_method text,
  p_new_price numeric default null,
  p_original_price numeric default null
) returns void
language plpgsql as $fn$
begin
  update bookings
     set paid = true,
         payment_method = coalesce(p_payment_method, payment_method),
         original_price = case
            when p_new_price is not null then coalesce(p_original_price, treatment_price)
            else original_price
         end,
         treatment_price = case
            when p_new_price is not null then p_new_price
            else treatment_price
         end,
         commission_amount = case
            when p_new_price is not null then round(commission_percent / 100.0 * p_new_price)
            else commission_amount
         end
   where id = p_booking_id and outlet_id = p_outlet_id;

  if p_therapist_id is not null then
    update therapists
       set current_paid = true,
           current_payment_method = coalesce(p_payment_method, current_payment_method),
           current_price = (
             select coalesce(sum(coalesce(treatment_price,0)),0)
               from bookings
              where therapist_id = p_therapist_id
                and outlet_id = p_outlet_id
                and status = 'berjalan'
           )
     where id = p_therapist_id
       and exists (
         select 1 from bookings b
         where b.id = p_booking_id and b.outlet_id = p_outlet_id
           and b.therapist_id = p_therapist_id
       );
  end if;
end;
$fn$;
