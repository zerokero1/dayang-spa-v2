-- ============================================================
-- PATCH: Continue Treatment (lanjutkan/input di pertengahan)
--
-- RPC continue_booking: menambah treatment BARU pada terapis yang
-- sedang 'ambil_tamu', menggabungkannya ke sesi yang sama.
--   - stok minyak dikurangi (jika pakai)
--   - booking baru dibuat dgn group_id yang sama dgn sesi terapis
--   - current_booking_ids/nama di-append
--   - end_at terapis DIPERPANJANG sesuai durasi tambahan
--   - current_price dijumlah ulang, current_paid di-update
--
-- JALANKAN: Supabase Dashboard -> SQL Editor -> New query -> RUN
-- ============================================================
create or replace function continue_booking(
  p_therapist_id uuid,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes int,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text,
  p_customer_name text default '',
  p_paid boolean default false,
  p_payment_method text default 'cash'
) returns uuid
language plpgsql
as $$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_outlet text;
  v_group text;
  v_start bigint;
  v_end bigint;
  v_old_end bigint;
begin
  -- Ambil konteks sesi terapis saat ini
  select
    current_outlet_id,
    current_group_id,
    end_at
  into v_outlet, v_group, v_old_end
  from therapists
  where id = p_therapist_id;

  if v_outlet is null then
    raise exception 'Terapis tidak sedang mengambil tamu';
  end if;

  -- Durasi tambahan diperpanjang dari akhir sesi saat ini (atau dari sekarang
  -- bila sesi sudah lewat waktunya): end_baru = max(end_lama, now) + durasi_baru
  v_start := (extract(epoch from now())::bigint * 1000);
  v_end := greatest(coalesce(v_old_end, v_start), v_start) + (p_duration_minutes * 60000);

  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;

  -- Kurangi stok minyak (jika pakai)
  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size;
  end if;

  insert into bookings (
    outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
    treatment_price, commission_percent, commission_amount, duration_minutes,
    uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
    group_id, start_at, end_at, created_at, original_price
  )
  select
    th.current_outlet_id, th.id, th.name, p_treatment_id, p_treatment_name,
    p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
    p_uses_oil, p_oil_type, p_oil_size, p_customer_name,
    'berjalan', p_paid, p_payment_method,
    th.current_group_id, v_start, v_end, now(), null
  from therapists th
  where th.id = p_therapist_id
  returning id into v_booking_id;

  -- Perpanjang end_at terapis & agregasi ulang current_price / paid
  update therapists t set
    current_booking_ids = coalesce(t.current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
    current_booking_id = v_booking_id::text,
    current_treatment_names = coalesce(t.current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_treatment_name),
    current_price = (
      select sum(treatment_price) from bookings
      where therapist_id = p_therapist_id and status = 'berjalan'
    ),
    current_paid = (
      select bool_and(paid) from bookings
      where therapist_id = p_therapist_id and status = 'berjalan'
    ),
    current_payment_method = coalesce(t.current_payment_method, p_payment_method),
    end_at = v_end
  where t.id = p_therapist_id;

  return v_booking_id;
end;
$$;

grant execute on function public.continue_booking(uuid, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text) to authenticated;
grant execute on function public.continue_booking(uuid, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text) to anon;
