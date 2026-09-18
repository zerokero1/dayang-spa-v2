-- ============================================================
-- TERAPIS ONCALL DIBLOKIR 20 MENIT SEBELUM JAM MULAI
--
-- Sebelumnya: begitu order oncall disimpan, terapis langsung
-- diblock (status ambil_tamu) sampai jam oncall selesai.
-- Setelah ini: terapis TIDAK langsung diblock saat disimpan;
-- dia diblock otomatis tepat 20 menit sebelum jam mulai oncall
-- (dilakukan oleh auto_free_expired_therapists yang dipanggil
-- web app setiap 30 detik), dan tetap block sampai jam selesai.
--
-- Contoh: sekarang 17.00, oncall 19.00, durasi 90 mnt
--   * 17.00           -> terapis masih FREE (bisa di-PA lain)
--   * 18.40           -> otomatis jadi 'ambil_tamu' (terblokir)
--   * 20.30           -> otomatis free lagi
--
-- Isi:
--   1. create_oncall_booking          (single, legacy)
--   2. create_oncall_booking_multi    (multi-terapis)
--   3. auto_free_expired_therapists   (+ blokir oncall masuk)
--
-- CUKUP JALANKAN FILE INI SEKALI di Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1. create_oncall_booking (single, TIDAK langsung block)
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

  -- JADWAL oncall disimpan, tapi status TIDAK diubah ke ambil_tamu.
  -- Block/pemblokiran dilakukan otomatis 20 menit sebelum jam mulai
  -- oleh auto_free_expired_therapists.
  update therapists set
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
-- 2. create_oncall_booking_multi (multi, TIDAK langsung block)
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

    -- JADWAL oncall disimpan, tapi status TIDAK diubah ke ambil_tamu.
    -- Block/pemblokiran dilakukan otomatis 20 menit sebelum jam mulai
    -- oleh auto_free_expired_therapists.
    update therapists set
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
-- 3. auto_free_expired_therapists
--    + BLOKIR otomatis oncall 20 menit sebelum jam mulai
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
  --     KECUALI yang sedang ONCALL (booking status 'selesai' tapi terapis
  --     diberi blok sementara) — itu dibebaskan oleh kasus (1) begitu
  --     jam oncall selesai (end_at lewat).
  for r in
    select t.id as tid
    from therapists t
    where t.status = 'ambil_tamu'
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id and b.status = 'berjalan'
      )
      and not exists (
        select 1 from bookings b
        where b.therapist_id = t.id
          and b.booking_source = 'oncall'
          and b.status <> 'batal'
      )
  loop
    perform clear_therapist_session(r.tid);
    v_done := v_done + 1;
  end loop;

  -- (3) BLOKIR ONCALL MASUK: terapis yang masih FREE tapi punya
  --     jadwal oncall akan diblock mulai (jam mulai - 20 menit)
  --     sampai jam selesai oncall.
  for r in
    select b.therapist_id as tid,
           b.outlet_id,
           b.id as booking_id,
           b.treatment_name,
           b.treatment_price,
           b.payment_method,
           b.start_at,
           b.end_at
    from bookings b
    where b.booking_source = 'oncall'
      and b.status <> 'batal'
      and b.start_at is not null
      and b.end_at is not null
      and b.start_at <= v_now + 1200000   -- mulai sudah <= (sekarang + 20 menit)
      and b.end_at > v_now                -- oncall belum selesai
  loop
    if not exists (
      select 1 from therapists t where t.id = r.tid and t.status = 'ambil_tamu'
    ) then
      update therapists set
        status = 'ambil_tamu',
        current_outlet_id = r.outlet_id,
        current_group_id = 'oncall:' || r.booking_id::text,
        current_booking_id = r.booking_id::text,
        current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(r.booking_id::text),
        current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(r.treatment_name),
        current_treatment_name = r.treatment_name,
        current_paid = true,
        current_payment_method = r.payment_method,
        current_price = r.treatment_price,
        start_at = r.start_at,
        end_at = r.end_at
      where id = r.tid;
      v_done := v_done + 1;
    end if;
  end loop;

  return v_done;
end;
$fn$;

grant execute on function public.auto_free_expired_therapists() to authenticated;