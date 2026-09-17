-- ============================================================
-- PATCH KOMISI ONCALL: komisi terapis = % × (harga − komisi hotel)
-- Rumus baru: commission_amount = round(commission_percent/100 * (treatment_price − hotel_commission))
--
-- Isi dari file ini:
--   1. Re-create 3 fungsi oncall dengan rumus baru (aman untuk
--      dijalankan berulang / idempotent).
--   2. Perbaiki data booking oncall LAMA yang masih pakai rumus
--      lama (komisi belum dikurangi komisi hotel).
--   3. Query pengecekan hasil.
--
-- CUKUP JALANKAN FILE INI SEKALI di Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1a. create_oncall_booking (single, legacy)
-- ============================================================
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

  if exists (select 1 from therapists where id = p_therapist_id and status = 'ambil_tamu') then
    raise exception 'Terapis sedang sibuk (Ambil Tamu), tidak bisa dijadwalkan oncall';
  end if;

  select round(p_commission_percent/100.0 * (p_treatment_price - coalesce(p_hotel_commission, 0))) into v_commission;
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

  update therapists set
    status = 'ambil_tamu',
    current_outlet_id = p_outlet_id,
    current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
    current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_package_name),
    current_treatment_name = p_package_name,
    current_booking_id = v_booking_id::text,
    current_paid = true,
    current_payment_method = p_payment_method,
    current_price = p_treatment_price,
    current_group_id = 'oncall:' || v_booking_id::text,
    start_at = v_start_at,
    end_at = v_end_at
  where id = p_therapist_id;

  return v_booking_id;
end;
$$;

grant execute on function public.create_oncall_booking(text, uuid, text, int, numeric, text, text, numeric, numeric) to authenticated;
grant execute on function public.create_oncall_booking(text, uuid, text, int, numeric, text, text, numeric, numeric) to anon;

-- ============================================================
-- 1b. create_oncall_booking_multi (multi-terapis)
-- ============================================================
create or replace function public.create_oncall_booking_multi(
  p_outlet_id text,
  p_customer_name text,
  p_payment_method text,
  p_package_name text,
  p_duration_minutes int,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_hotel_commission numeric,
  p_entries jsonb
) returns void
language plpgsql
as $$
declare
  v_e jsonb;
  v_tid uuid;
  v_tname text;
  v_start_hour int;
  v_start_minute int;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_wib date;
  v_commission numeric;
  v_booking_id uuid;
  v_count int := 0;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Minimal satu terapis harus dipilih dengan waktu mulai';
  end if;

  select round(p_commission_percent/100.0 * (p_treatment_price - coalesce(p_hotel_commission, 0))) into v_commission;
  v_wib := (now() at time zone 'utc' + interval '7 hours')::date;

  for v_e in select value from jsonb_array_elements(p_entries) loop
    v_tid := (v_e->>'therapist_id')::uuid;
    v_start_hour := (v_e->>'start_hour')::int;
    v_start_minute := (v_e->>'start_minute')::int;

    select name into v_tname from therapists where id = v_tid;
    if v_tname is null then
      raise exception 'Terapis tidak ditemukan';
    end if;

    if exists (select 1 from therapists where id = v_tid and status = 'ambil_tamu') then
      raise exception 'Terapis % sedang sibuk (Ambil Tamu), tidak bisa dijadwalkan oncall', v_tname;
    end if;

    if v_start_hour is null or v_start_minute is null then
      raise exception 'Waktu mulai belum diatur untuk terapis %', v_tname;
    end if;

    v_start_ts := (v_wib + make_interval(hours => v_start_hour, mins => v_start_minute))
                  at time zone 'Asia/Makassar';

    if v_start_ts < now() - interval '5 minutes' then
      raise exception 'Waktu mulai untuk % sudah lewat/terlalu dekat. Pilih jam di masa depan.', v_tname;
    end if;

    v_end_ts := v_start_ts + make_interval(mins => p_duration_minutes);

    insert into bookings (
      outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
      treatment_price, commission_percent, commission_amount, duration_minutes,
      uses_oil, customer_name, status, paid, payment_method,
      start_at, end_at, created_at, original_price,
      booking_source, hotel_commission
    ) values (
      p_outlet_id, v_tid, v_tname, null,
      p_package_name, p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
      false, p_customer_name, 'selesai', true, p_payment_method,
      (extract(epoch from v_start_ts)::bigint * 1000),
      (extract(epoch from v_end_ts)::bigint * 1000),
      now(), p_treatment_price,
      'oncall', p_hotel_commission
    ) returning id into v_booking_id;

    -- Blok terapis sampai jam oncall selesai (group penanda 'oncall:<id>').
    update therapists set
      status = 'ambil_tamu',
      current_outlet_id = p_outlet_id,
      current_group_id = 'oncall:' || v_booking_id::text,
      current_booking_id = v_booking_id::text,
      current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
      current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_package_name),
      current_treatment_name = p_package_name,
      current_paid = true,
      current_payment_method = p_payment_method,
      current_price = p_treatment_price,
      start_at = (extract(epoch from v_start_ts)::bigint * 1000),
      end_at = (extract(epoch from v_end_ts)::bigint * 1000)
    where id = v_tid;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Tidak ada terapis yang berhasil dijadwalkan';
  end if;
end;
$$;

grant execute on function public.create_oncall_booking_multi(text, text, text, text, int, numeric, numeric, numeric, jsonb) to authenticated;
grant execute on function public.create_oncall_booking_multi(text, text, text, text, int, numeric, numeric, numeric, jsonb) to anon;

-- ============================================================
-- 1c. edit_oncall_booking
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
         commission_amount = round(p_commission_percent / 100.0 * (p_price - coalesce(p_hotel_commission, 0))),
         hotel_commission = p_hotel_commission,
         customer_name = coalesce(p_customer_name, ''),
         payment_method = p_payment_method
   where id = p_booking_id and booking_source = 'oncall';
end;
$function$;

grant execute on function public.edit_oncall_booking(uuid, uuid, text, text, integer, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.edit_oncall_booking(uuid, uuid, text, text, integer, numeric, numeric, numeric, text, text) to anon;

-- ============================================================
-- 2. PERBAIKI DATA ONCALL LAMA
--    Booking oncall yang masih pakai rumus lama (komisi dihitung
--    dari harga penuh) disesuaikan ke rumus baru.
--    Laporan komisi (bookings.commission_amount) ikut terkoreksi.
-- ============================================================
update bookings
   set commission_amount = round(commission_percent / 100.0 * (treatment_price - coalesce(hotel_commission, 0)))
 where booking_source = 'oncall'
   and commission_percent is not null;

-- ============================================================
-- 3. PENYAKSI (opsional, boleh dijalankan untuk cek hasil)
-- ============================================================
select
  id,
  therapist_name,
  treatment_name,
  treatment_price,
  hotel_commission,
  commission_percent,
  commission_amount as komisi_sekarang,
  round(commission_percent / 100.0 * (treatment_price - coalesce(hotel_commission, 0))) as komisi_seharusnya
from bookings
where booking_source = 'oncall'
order by created_at desc
limit 50;