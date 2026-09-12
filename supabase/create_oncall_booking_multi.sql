-- ============================================================
-- ONCALL MULTI-TERAPIS (jadwal per terapis bisa beda)
-- Membuat satu booking per terapis (bookings.booking_source='oncall'),
-- TANPA menghubungkan ke treatment/tabel therapists via current_*.
-- Status langsung 'selesai' (lunas), komisi hotel & terapis tercatat.
-- Terapis tetap DIBLOK di list sampai jam oncall selesai.
--
-- p_entries contoh: [
--   {"therapist_id":"<uuid>","start_hour":9,"start_minute":0},
--   {"therapist_id":"<uuid>","start_hour":9,"start_minute":90}
-- ]
--
-- JALANKAN di Supabase SQL Editor.
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

  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
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