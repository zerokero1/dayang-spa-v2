-- ============================================================================
-- PERBAIKAN: ONCALL TERBLOK SEJAK DICATAT
-- Dibuat : 14/10/2026
--
-- MASALAH
--   RPC create_oncall_booking dan create_oncall_booking_multi menyisipkan
--   booking dengan status = 'selesai' dan paid = true dari awal:
--
--       insert into bookings (..., status, paid, ...)
--       values (..., 'selesai', true, ...)
--
--   Padahal oncall dicatat SEBELUM treatment-nya selesai. Contoh nyata:
--   Indah dan Riska, treatment 14/10 18.03 - 19.03, dicatat jam 18.05 -
--   langsung sudah berstatus 'selesai'.
--
--   Akibatnya di aplikasi:
--     - list WhatsApp tidak memberi tanda ❌ maupun 🔶ONCALL, karena
--       detektinya mencari status 'berjalan'
--     - therapeutic tidak terkunci di papan, bisa menerima tamu lain
--     - booking oncall dianggap selesai sebelum waktunya
--
--   RPC-nya sebenarnya sudah mengisi kolom kunci terapis
--   (current_group_id = 'oncall:<id>', current_booking_ids, start_at, end_at),
--   tapi TIDAK pernah mengubah therapists.status menjadi 'ambil_tamu'.
--
-- PERBAIKAN
--   1. status booking oncall menjadi 'berjalan' saat dicatat
--   2. therapists.status menjadi 'ambil_tamu' sehingga terapis terkunci
--
--   paid sengaja TETAP true. Oncall ditagihkan hotel dan dicatat lunas di
--   system sejak awal; yang diperbaiki hanya status treatment.
--
-- LEPAS OTOMATIS
--   Setelah jam selesai lewat, autoFreeService (bebaskanTherapisYangSelesai)
--   akan membebaskan terapis karena tidak lagi ada booking 'berjalan' dengan
--   end_at di masa depan. Tidak perlu tombol manual.
--
-- CARA KEMBALI
--   Jalankan file backup_oncall_rpc_sebelum_perbaikan_20261014.sql
--   (= supabase/backup/oncall_rpc_sebelum_perbaikan_20261014.sql).
--
--   Booking oncall yang SUDAH terlanjur tercatat tidak ikut berubah -
--   hanya oncall baru setelah patch ini yang terblokir.
-- ============================================================================


-- ============================================================================
-- 1. create_oncall_booking (satu terapis)
-- ============================================================================
create or replace function public.create_oncall_booking(
  p_outlet_id text,
  p_therapist_id uuid,
  p_package_name text,
  p_duration_minutes integer,
  p_treatment_price numeric,
  p_customer_name text,
  p_payment_method text,
  p_commission_percent numeric,
  p_hotel_commission numeric
) returns uuid
language plpgsql
volatile
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
    false, p_customer_name, 'berjalan', true, p_payment_method,
    v_start_at, v_end_at, now(), p_treatment_price,
    'oncall', p_hotel_commission
  ) returning id into v_booking_id;

  -- status = 'ambil_tamu' inilah yang membuat terapis terkunci di papan.
  -- Tanpa itu, RPC hanya mengisi kolom info tapi-board tetap bilang free.
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


-- ============================================================================
-- 2. create_oncall_booking_multi (banyak terapis sekaligus)
-- ============================================================================
create or replace function public.create_oncall_booking_multi(
  p_outlet_id text,
  p_customer_name text,
  p_payment_method text,
  p_package_name text,
  p_duration_minutes integer,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_hotel_commission numeric,
  p_entries jsonb
) returns void
language plpgsql
volatile
as $$
declare
  v_count integer := 0;
  v_commission numeric;
  e record;
  v_tid uuid;
  v_tname text;
  v_booking_id uuid;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_start_at bigint;
  v_end_at bigint;
begin
  if p_entries is null or jsonb_array_length(p_entries) = 0 then
    raise exception 'Tidak ada terapis yang dipilih';
  end if;

  select round(p_commission_percent/100.0 * (p_treatment_price - coalesce(p_hotel_commission, 0))) into v_commission;

  for e in select * from jsonb_to_recordset(p_entries) as x(therapist_id uuid, start_at timestamptz)
  loop
    v_tid := e.therapist_id;

    select name into v_tname from therapists where id = v_tid;
    if v_tname is null then
      continue;
    end if;

    v_start_ts := e.start_at;
    if v_start_ts is null then
      v_start_ts := now();
    end if;
    if v_start_ts < now() then
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
      false, p_customer_name, 'berjalan', true, p_payment_method,
      (extract(epoch from v_start_ts)::bigint * 1000),
      (extract(epoch from v_end_ts)::bigint * 1000),
      now(), p_treatment_price,
      'oncall', p_hotel_commission
    ) returning id into v_booking_id;

    -- status = 'ambil_tamu' inilah yang membuat terapis terkunci di papan.
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

  -- Definisi aslinya mengembalikan void, jadi ikut dipertahankan agar
  -- aplikasi tidak perlu diubah di sisi pemanggilnya.
end;
$$;


-- ============================================================================
-- 3. CEK HASIL
-- Booking oncall yang dibuat SESUDAH patch harus berstatus 'berjalan'.
-- ============================================================================
select
  status::text                                                        as status,
  count(*)::int                                                       as jumlah,
  count(*) filter (where end_at > (extract(epoch from now()) * 1000)::bigint)::int as belum_selesai_waktunya
from bookings
where booking_source = 'oncall'
  and created_at > now() - interval '1 day'
group by 1;

-- Terapis yang terkunci oleh oncall (harus ada setelah ada oncall baru).
select
  t.name,
  t.status::text                                                      as status_papan,
  b.status::text                                                      as status_booking,
  to_char(to_timestamp(b.start_at / 1000.0), 'DD/MM HH24:MI')          as mulai,
  to_char(to_timestamp(b.end_at / 1000.0), 'DD/MM HH24:MI')            as selesai
from therapists t
join bookings b on b.therapist_id = t.id
where b.booking_source = 'oncall'
  and b.status = 'berjalan'
  and b.end_at > (extract(epoch from now()) * 1000)::bigint
order by b.end_at;