-- ============================================================
-- FIX BESAR: Izin menjalankan RPC + perbaikan create_booking
--
-- MASALAH:
--   1. Semua fungsi RPC TIDAK punya GRANT EXECUTE untuk role
--      'authenticated' (kasir). Akibatnya RPC seperti
--      create_booking GAGAL -> booking TIDAK tersimpan ->
--      tabel bookings kosong -> komisi di list terapis tidak muncul.
--
-- JALANKAN di Supabase SQL Editor -> "Run".
-- ============================================================

-- ------------------------------------------------------------------
-- BAGIAN 1: Beri izin EXECUTE semua fungsi RPC ke role authenticated
-- ------------------------------------------------------------------
grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all procedures in schema public to authenticated;
grant execute on all functions in schema public to anon;
grant execute on all procedures in schema public to anon;

-- ============================================================
-- BAGIAN 2: Perbaiki create_booking agar mengisi start_at/end_at
-- pada kolom therapist (jam mulai & selesai muncul di Status Terapis)
-- ============================================================
create or replace function create_booking(
  p_outlet_id text,
  p_therapist_id uuid,
  p_therapist_name text,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes int,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text,
  p_customer_name text,
  p_paid boolean,
  p_payment_method text,
  p_group_id text,
  p_update_therapist boolean default true
) returns uuid
language plpgsql
as $$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end_at bigint;
  v_start_at bigint;
begin
  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
  v_start_at := (extract(epoch from now())::bigint * 1000);
  v_end_at := v_start_at + (p_duration_minutes * 60000);

  -- Kurangi stok minyak (jika pakai)
  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size;
  end if;

  insert into bookings (
    outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
    treatment_price, commission_percent, commission_amount, duration_minutes,
    uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
    group_id, start_at, end_at, created_at
  ) values (
    p_outlet_id, p_therapist_id, p_therapist_name, p_treatment_id, p_treatment_name,
    p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
    p_uses_oil, p_oil_type, p_oil_size, p_customer_name,
    'berjalan', p_paid, p_payment_method, p_group_id,
    v_start_at, v_end_at, now()
  ) returning id into v_booking_id;

  if p_update_therapist and p_therapist_id is not null then
    update therapists set
      status = 'ambil_tamu',
      current_outlet_id = p_outlet_id,
      current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
      current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_treatment_name),
      current_booking_id = v_booking_id::text,
      current_treatment_name = p_treatment_name,
      current_paid = p_paid,
      current_payment_method = p_payment_method,
      current_price = p_treatment_price,
      current_group_id = p_group_id,
      start_at = v_start_at,
      end_at = v_end_at
    where id = p_therapist_id;
  end if;

  return v_booking_id;
end;
$$;

-- Beri izin EXECUTE untuk fungsi yang baru dibuat ulang
grant execute on function public.create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean) to authenticated;
