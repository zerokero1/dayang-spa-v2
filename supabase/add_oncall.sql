-- ============================================================
-- ONCALL FULL BODY MASSAGE (ke hotel)
-- 1. Tambah kolom penanda di tabel bookings:
--    - booking_source  : 'in_house' (biasa) / 'oncall' (order hotel)
--    - hotel_commission: komisi yang harus dibayar ke hotel (Rp)
-- 2. RPC create_oncall_booking: simpan order oncall sebagai booking
--    (status 'selesai', langsung lunas, komisi hotel tercatat).
--    Booking oncall TIDAK mengubah status terapis (tidak dihitung sesi
--    dalam toko), tapi tetap tampil di laporan omzet/komisi.
--
-- Menu oncall full body massage:
--   Mambo        : 350k/60mnt, 500k/90mnt  -> komisi hotel 100k
--   Niyama & Rac: 300k/60mnt, 450k/90mnt   -> komisi hotel 50k
--   Lainnya      : 400k/60mnt, 600k/90mnt   -> komisi hotel 50k
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

alter table bookings add column if not exists booking_source text not null default 'in_house';
alter table bookings add column if not exists hotel_commission numeric not null default 0;

create or replace function create_oncall_booking(
  p_outlet_id text,
  p_therapist_id uuid,
  p_package_name text,
  p_duration_minutes int,
  p_treatment_price numeric,
  p_customer_name text,
  p_payment_method text,
  p_commission_percent numeric,
  p_hotel_commission numeric
) returns uuid
language plpgsql
as $$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_therapist_name text;
  v_start_at bigint;
  v_end_at bigint;
begin
  select name into v_therapist_name from therapists where id = p_therapist_id;
  if v_therapist_name is null then
    raise exception 'Terapis tidak ditemukan';
  end if;

  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
  v_start_at := (extract(epoch from now())::bigint * 1000);
  v_end_at := v_start_at + (p_duration_minutes * 60000);

  insert into bookings (
    outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
    treatment_price, commission_percent, commission_amount, duration_minutes,
    uses_oil, customer_name, status, paid, payment_method,
    start_at, end_at, created_at, original_price,
    booking_source, hotel_commission
  ) values (
    p_outlet_id, p_therapist_id, v_therapist_name, null,
    p_package_name, p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
    false, p_customer_name, 'selesai', true, p_payment_method,
    v_start_at, v_end_at, now(), p_treatment_price,
    'oncall', p_hotel_commission
  ) returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.create_oncall_booking(text, uuid, text, int, numeric, text, text, numeric, numeric) to authenticated;
grant execute on function public.create_oncall_booking(text, uuid, text, int, numeric, text, text, numeric, numeric) to anon;