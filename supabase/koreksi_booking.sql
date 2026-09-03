-- ============================================================
-- KOREKSI BOOKING — KHUSUS AKUN OFFICE (office.op@dayang.com)
--
-- Tujuan: hanya akun office.op@dayang.com yang boleh mengoreksi
-- booking yang salah input oleh kasir, berupa:
--   1. Mengubah treatment / harga / minyak booking
--   2. Mengubah % komisi pada booking
--   3. Mengubah terapis pada booking
--
-- Berlaku untuk semua status booking (berjalan / lunas / selesai),
-- kecuali yang sudah dibatalkan (batal / batal_sebagian).
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: cek apakah user yang sedang login adalah office
-- ------------------------------------------------------------
create or replace function is_office_op()
returns boolean
language sql
stable
security definer
as $$
  select lower(coalesce(
    (auth.jwt() ->> 'email'),
    (select u.email from auth.users u where u.id = auth.uid()),
    ''
  )) = 'office.op@dayang.com'
$$;

grant execute on function public.is_office_op() to authenticated;

-- ------------------------------------------------------------
-- Helper: bangun ulang session seorang terapis dari semua
-- booking-nya yang masih berjalan (status = 'berjalan').
-- Jika tidak ada, terapis dikembalikan ke free.
-- ------------------------------------------------------------
create or replace function refresh_therapist_session(p_therapist_id uuid)
returns void
language plpgsql
as $$
declare
  v_count int;
  v_total_price numeric;
  v_total_duration int;
  v_outlet text;
  v_ids jsonb;
  v_names jsonb;
  v_all_paid boolean;
  v_method text;
  v_start bigint;
  v_end bigint;
begin
  select
    count(*),
    coalesce(sum(coalesce(treatment_price,0)),0),
    coalesce(sum(coalesce(duration_minutes,0)),0),
    min(outlet_id),
    jsonb_agg(id::text order by start_at),
    jsonb_agg(treatment_name order by start_at),
    bool_and(coalesce(paid,false)),
    (array_agg(payment_method order by start_at))[1],
    min(start_at),
    max(end_at)
  into v_count, v_total_price, v_total_duration, v_outlet,
       v_ids, v_names, v_all_paid, v_method, v_start, v_end
  from bookings
  where therapist_id = p_therapist_id and status = 'berjalan';

  if v_count is null or v_count = 0 then
    update therapists set
      status = 'free', current_outlet_id = null,
      current_booking_ids = null, current_booking_id = null,
      current_treatment_names = null, current_treatment_name = null,
      current_paid = null, current_payment_method = null,
      current_price = null, current_group_id = null,
      start_at = null, end_at = null
    where id = p_therapist_id;
  else
    update therapists set
      status = 'ambil_tamu',
      current_outlet_id = v_outlet,
      current_booking_ids = v_ids,
      current_booking_id = v_ids->>0,
      current_treatment_names = v_names,
      current_treatment_name = v_names->>0,
      current_paid = v_all_paid,
      current_payment_method = v_method,
      current_price = v_total_price,
      start_at = v_start,
      end_at = v_end
    where id = p_therapist_id;
  end if;
end;
$$;

grant execute on function public.refresh_therapist_session(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC UTAMA: koreksi booking (hanya office)
--   p_treatment_id   : treatment baru (nullable = tetap)
--   p_treatment_price: harga baru (wajib bila ganti treatment)
--   p_commission_percent: % komisi baru (nullable = tetap)
--   p_new_therapist_id  : terapis baru (nullable = tetap)
--   p_oil_type / p_oil_size / p_uses_oil : sesuaikan minyak
-- ------------------------------------------------------------
create or replace function edit_booking_correction(
  p_booking_id uuid,
  p_treatment_id uuid default null,
  p_treatment_name text default null,
  p_treatment_price numeric default null,
  p_commission_percent numeric default null,
  p_new_therapist_id uuid default null,
  p_uses_oil boolean default null,
  p_oil_type text default null,
  p_oil_size text default null
) returns void
language plpgsql as $fn$
declare
  v_outlet text;
  v_old_therapist uuid;
  v_orig_uses_oil boolean;
  v_old_oil_type text;
  v_old_oil_size text;
  v_old_oil text;
  v_new_oil text;
  v_new_price numeric;
  v_new_commission numeric;
  v_status text;
begin
  -- ---- KEAMANAN: wajib office ---- 
  if not is_office_op() then
    raise exception 'Anda tidak berhak melakukan koreksi booking.';
  end if;

  -- ---- Ambil data lama ----
  select outlet_id, therapist_id, uses_oil, oil_type, oil_size,
         treatment_price, commission_percent, status
    into v_outlet, v_old_therapist, v_orig_uses_oil, v_old_oil_type, v_old_oil_size,
         v_new_price, v_new_commission, v_status
    from bookings where id = p_booking_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if v_status in ('batal', 'batal_sebagian') then
    raise exception 'Booking sudah dibatalkan dan tidak bisa dikoreksi.';
  end if;

  -- ---- Tentukan nilai baru (fallback ke lama) ----
  v_new_price := coalesce(p_treatment_price, v_new_price);
  v_new_commission := coalesce(p_commission_percent, v_new_commission);

  -- Stok: bandingkan minyak LAMA (asal dari DB) vs minyak BARU (hasil koreksi)
  v_old_oil := case when v_orig_uses_oil then (coalesce(v_old_oil_type,'')||'_'||coalesce(v_old_oil_size,'')) end;
  v_new_oil := case when coalesce(p_uses_oil, v_orig_uses_oil) then (coalesce(p_oil_type,'')||'_'||coalesce(p_oil_size,'')) end;

  if v_old_oil is distinct from v_new_oil then
    if v_orig_uses_oil and v_old_oil_type is not null and v_old_oil_size is not null then
      update oil_inventory set stock = stock + 1
       where outlet_id = v_outlet and oil_type = v_old_oil_type and size = v_old_oil_size;
    end if;
    if coalesce(p_uses_oil, v_orig_uses_oil) and p_oil_type is not null and p_oil_size is not null then
      if (select stock from oil_inventory
           where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size) <= 0 then
        raise exception 'Stok minyak habis';
      end if;
      update oil_inventory set stock = stock - 1
       where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size;
    end if;
  end if;

  -- ---- Update booking ----
  update bookings set
    treatment_id = coalesce(p_treatment_id, treatment_id),
    treatment_name = coalesce(p_treatment_name, treatment_name),
    treatment_price = v_new_price,
    commission_percent = v_new_commission,
    commission_amount = round(v_new_commission / 100.0 * v_new_price),
    uses_oil = coalesce(p_uses_oil, uses_oil),
    oil_type = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_type, oil_type) else null end,
    oil_size = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_size, oil_size) else null end,
    therapist_id = coalesce(p_new_therapist_id, therapist_id),
    therapist_name = case
      when p_new_therapist_id is not null
        then (select name from therapists where id = p_new_therapist_id)
      else therapist_name
    end
  where id = p_booking_id;

  -- ---- Perbarui session terapis bila terapis diganti / aktif ----
  if p_new_therapist_id is not null and p_new_therapist_id <> v_old_therapist then
    perform refresh_therapist_session(v_old_therapist);
    perform refresh_therapist_session(p_new_therapist_id);
  elsif v_status = 'berjalan' then
    perform refresh_therapist_session(v_old_therapist);
  end if;

  -- ---- Audit ----
  perform log_audit('edit', p_booking_id, v_outlet,
    jsonb_build_object(
      'treatment_id', p_treatment_id,
      'treatment_name', p_treatment_name,
      'treatment_price', p_treatment_price,
      'commission_percent', p_commission_percent,
      'therapist_id', p_new_therapist_id,
      'uses_oil', p_uses_oil,
      'oil_type', p_oil_type,
      'oil_size', p_oil_size
    ));
end;
$fn$;

grant execute on function public.edit_booking_correction(uuid, uuid, text, numeric, numeric, uuid, boolean, text, text) to authenticated;
