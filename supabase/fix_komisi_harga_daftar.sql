-- ===========================================================================
-- KOMISI DIHITUNG DARI HARGA DAFTAR, BUKAN HARGA YANG DIBAYAR
--
-- create_booking / mark_booking_paid / edit_booking_details /
-- edit_booking_correction memakai `persen x treatment_price`, padahal
-- treatment_price adalah harga SETELAH diskon (termasuk Happy Hour Rp 250.000).
-- Akibatnya komisi therapist ikut turun setiap kali pelanggan dapat diskon,
-- padahal diskon itu keputusan kasir/promosi, bukan komisi therapist.
--
-- Harga daftar sudah tersimpan di bookings.original_price (diisi kalau harga
-- bayar < harga daftar). Kalau NULL, harga daftar = treatment_price itu sendiri.
--
-- Dampak di produksi saat patch ini dibuat: 58 booking berdiskon, komisi
-- tertahan Rp305.460 (Rp767.540 vs seharusnya Rp1.073.000).
--
-- Booking HISTORIS tidak diubah oleh file ini.
--
-- Di-generate otomatis oleh patch-komisi.mjs dari definisi fungsi yang ada di
-- produksi, jadi tidak ada penulisan ulang manual yang bisa berubah sendiri.
-- ===========================================================================
-- create_booking
CREATE OR REPLACE FUNCTION public.create_booking(p_outlet_id text, p_therapist_id uuid, p_therapist_name text, p_treatment_id uuid, p_treatment_name text, p_treatment_price numeric, p_commission_percent numeric, p_duration_minutes integer, p_uses_oil boolean, p_oil_type text, p_oil_size text, p_customer_name text, p_paid boolean, p_payment_method text, p_group_id text, p_update_therapist boolean DEFAULT true, p_original_price numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end_at bigint;
  v_start_at bigint;
begin
  select round(p_commission_percent/100.0 * coalesce(p_original_price, p_treatment_price)) into v_commission;
  v_start_at := (extract(epoch from now())::bigint * 1000);
  v_end_at := v_start_at + (p_duration_minutes * 60000);

  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size;
  end if;

  insert into bookings (
    outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
    treatment_price, commission_percent, commission_amount, duration_minutes,
    uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
    group_id, start_at, end_at, created_at, original_price
  ) values (
    p_outlet_id, p_therapist_id, p_therapist_name, p_treatment_id, p_treatment_name,
    p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
    p_uses_oil, p_oil_type, p_oil_size, p_customer_name,
    'berjalan', p_paid, p_payment_method, p_group_id,
    v_start_at, v_end_at, now(), p_original_price
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
$function$


-- create_booking
CREATE OR REPLACE FUNCTION public.create_booking(p_outlet_id text, p_therapist_id uuid, p_therapist_name text, p_treatment_id uuid, p_treatment_name text, p_treatment_price numeric, p_commission_percent numeric, p_duration_minutes integer, p_uses_oil boolean, p_oil_type text, p_oil_size text, p_customer_name text, p_paid boolean, p_payment_method text, p_group_id text, p_update_therapist boolean DEFAULT true, p_original_price numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end_at bigint;
  v_start_at bigint;
  v_uid uuid := auth.uid();
  v_discount_pct numeric;
begin
  select round(p_commission_percent/100.0 * coalesce(p_original_price, p_treatment_price)) into v_commission;
  v_start_at := (extract(epoch from now())::bigint * 1000);
  v_end_at := v_start_at + (p_duration_minutes * 60000);
  -- Jika ada original_price lebih tinggi dari harga bayar -> dianggap diskon
  v_discount_pct := case
    when p_original_price is not null and p_original_price > p_treatment_price
      then round(100 - (p_treatment_price::numeric * 100 / p_original_price), 1)
    else 0
  end;

  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size;
  end if;

  insert into bookings (
    outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
    treatment_price, commission_percent, commission_amount, duration_minutes,
    uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
    group_id, start_at, end_at, created_at, original_price, created_by,
    discount_pct, discount_reason
  ) values (
    p_outlet_id, p_therapist_id, p_therapist_name, p_treatment_id, p_treatment_name,
    p_treatment_price, p_commission_percent, v_commission, p_duration_minutes,
    p_uses_oil, p_oil_type, p_oil_size, p_customer_name,
    'berjalan', p_paid, p_payment_method, p_group_id,
    v_start_at, v_end_at, now(), p_original_price, v_uid,
    v_discount_pct, case when v_discount_pct > 0 then p_discount_reason else null end
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

  perform log_audit('create', v_booking_id, p_outlet_id,
    jsonb_build_object('therapist', p_therapist_name, 'treatment', p_treatment_name,
      'price', p_treatment_price, 'original_price', p_original_price, 'paid', p_paid,
      'discount_reason', p_discount_reason));

  return v_booking_id;
end;
$function$


-- edit_booking_correction
CREATE OR REPLACE FUNCTION public.edit_booking_correction(p_booking_id uuid, p_treatment_id uuid DEFAULT NULL::uuid, p_treatment_name text DEFAULT NULL::text, p_treatment_price numeric DEFAULT NULL::numeric, p_commission_percent numeric DEFAULT NULL::numeric, p_new_therapist_id uuid DEFAULT NULL::uuid, p_uses_oil boolean DEFAULT NULL::boolean, p_oil_type text DEFAULT NULL::text, p_oil_size text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
    commission_amount = round(v_new_commission / 100.0 * coalesce(original_price, v_new_price)),
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
$function$


-- edit_booking_correction
CREATE OR REPLACE FUNCTION public.edit_booking_correction(p_booking_id uuid, p_treatment_id uuid DEFAULT NULL::uuid, p_treatment_name text DEFAULT NULL::text, p_treatment_price numeric DEFAULT NULL::numeric, p_commission_percent numeric DEFAULT NULL::numeric, p_new_therapist_id uuid DEFAULT NULL::uuid, p_uses_oil boolean DEFAULT NULL::boolean, p_oil_type text DEFAULT NULL::text, p_oil_size text DEFAULT NULL::text, p_discount_pct numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
  v_base numeric;
  v_old_original numeric;
  v_commission_base numeric;
  v_status text;
begin
  -- ---- KEAMANAN: wajib office ---- 
  if not is_office_op() then
    raise exception 'Anda tidak berhak melakukan koreksi booking.';
  end if;

  -- ---- Ambil data lama ----
  select outlet_id, therapist_id, uses_oil, oil_type, oil_size,
         treatment_price, commission_percent, status, original_price
    into v_outlet, v_old_therapist, v_orig_uses_oil, v_old_oil_type, v_old_oil_size,
         v_new_price, v_new_commission, v_status, v_old_original
    from bookings where id = p_booking_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if v_status in ('batal', 'batal_sebagian') then
    raise exception 'Booking sudah dibatalkan dan tidak bisa dikoreksi.';
  end if;

  -- ---- Tentukan nilai baru (fallback ke lama) ----
  v_new_price := coalesce(p_treatment_price, v_new_price);
  v_new_commission := coalesce(p_commission_percent, v_new_commission);

  -- ---- Terapkan diskon baru (bila dikirim) ----
  -- Basis diskon = harga yang dikoreksi (p_treatment_price), atau original_price
  -- yang sudah tersimpan, atau harga saat ini.
  if p_discount_pct is not null then
    if p_discount_pct < 0 or p_discount_pct > 100 then
      raise exception 'Diskon harus antara 0 dan 100%%.';
    end if;
    if p_discount_pct > 0 and coalesce(p_discount_reason, '') = '' then
      raise exception 'Alasan diskon wajib diisi.';
    end if;
    v_base := coalesce(p_treatment_price, v_old_original, v_new_price);
    if p_discount_pct > 0 then
      v_new_price := round(v_base * (1 - p_discount_pct / 100.0));
    else
      v_new_price := v_base;
    end if;
  end if;

  -- ---- Basis komisi = harga DAFTAR, bukan harga yang dibayar ----
  -- Kalau koreksi ini memasang diskon, harga daftarnya v_base (harga yang
  -- dikoreksi). Kalau tidak, harga daftarnya original_price yang sudah
  -- tersimpan, atau harga saat ini bila memang tidak pernah ada diskon.
  v_commission_base := case
    when p_discount_pct is not null then v_base
    else coalesce(v_old_original, v_new_price)
  end;

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
    commission_amount = round(v_new_commission / 100.0 * v_commission_base),
    uses_oil = coalesce(p_uses_oil, uses_oil),
    oil_type = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_type, oil_type) else null end,
    oil_size = case when coalesce(p_uses_oil, uses_oil) then coalesce(p_oil_size, oil_size) else null end,
    therapist_id = coalesce(p_new_therapist_id, therapist_id),
    therapist_name = case
      when p_new_therapist_id is not null
        then (select name from therapists where id = p_new_therapist_id)
      else therapist_name
    end,
    original_price = case
      when p_discount_pct is not null and p_discount_pct > 0 then v_base
      when p_discount_pct is not null and p_discount_pct = 0 then null
      else original_price
    end,
    discount_pct = case
      when p_discount_pct is not null then p_discount_pct
      else discount_pct
    end,
    discount_reason = case
      when p_discount_pct is not null and p_discount_pct > 0 then p_discount_reason
      when p_discount_pct is not null and p_discount_pct = 0 then null
      else discount_reason
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
      'oil_size', p_oil_size,
      'discount_pct', p_discount_pct,
      'discount_reason', p_discount_reason
    ));
end;
$function$


-- edit_booking_details
CREATE OR REPLACE FUNCTION public.edit_booking_details(p_outlet_id text, p_booking_id uuid, p_treatment_id uuid, p_treatment_name text, p_treatment_price numeric, p_commission_percent numeric, p_duration_minutes integer, p_uses_oil boolean, p_oil_type text, p_oil_size text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_old_uses_oil boolean;
  v_old_oil_type text;
  v_old_oil_size text;
  v_old_oil text;
  v_new_oil text;
  v_old_price numeric;
begin
  select uses_oil, oil_type, oil_size, treatment_price
    into v_old_uses_oil, v_old_oil_type, v_old_oil_size, v_old_price
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;
  if not found then raise exception 'Booking tidak ditemukan'; end if;

  v_old_oil  := case when v_old_uses_oil then (coalesce(v_old_oil_type,'')||'_'||coalesce(v_old_oil_size,'')) end;
  v_new_oil  := case when p_uses_oil     then (coalesce(p_oil_type,'')||'_'||coalesce(p_oil_size,'')) end;

  if v_old_oil is distinct from v_new_oil then
    if v_old_uses_oil and v_old_oil_type is not null and v_old_oil_size is not null then
      update oil_inventory set stock = stock + 1
       where outlet_id = p_outlet_id and oil_type = v_old_oil_type and size = v_old_oil_size;
    end if;
    if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
      if (select stock from oil_inventory
           where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size) <= 0 then
        raise exception 'Stok minyak habis';
      end if;
      update oil_inventory set stock = stock - 1
       where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size;
    end if;
  end if;

  update bookings set
    treatment_id = p_treatment_id,
    treatment_name = p_treatment_name,
    treatment_price = p_treatment_price,
    commission_percent = p_commission_percent,
    commission_amount = round(p_commission_percent / 100.0 * coalesce(original_price, p_treatment_price)),
    duration_minutes = p_duration_minutes,
    uses_oil = p_uses_oil,
    oil_type = case when p_uses_oil then p_oil_type else null end,
    oil_size = case when p_uses_oil then p_oil_size else null end
  where id = p_booking_id and outlet_id = p_outlet_id;

  perform log_audit('edit', p_booking_id, p_outlet_id,
    jsonb_build_object('old_price', v_old_price, 'new_price', p_treatment_price));
end;
$function$


-- mark_booking_paid
CREATE OR REPLACE FUNCTION public.mark_booking_paid(p_outlet_id text, p_booking_id uuid, p_therapist_id uuid, p_payment_method text, p_discount_pct numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_current_price numeric;
  v_new_price numeric;
  v_uid uuid := auth.uid();
begin
  select treatment_price, coalesce(original_price, treatment_price)
    into v_current_price, v_new_price
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if p_discount_pct is not null and p_discount_pct > 0 then
    if coalesce(p_discount_reason, '') = '' then
      raise exception 'Alasan diskon wajib diisi';
    end if;
    v_new_price := round(v_current_price * (1 - p_discount_pct / 100.0));
  end if;

  update bookings
     set paid = true,
         payment_method = coalesce(p_payment_method, payment_method),
         paid_by = v_uid,
         original_price = case
            when p_discount_pct is not null and p_discount_pct > 0 then coalesce(original_price, v_current_price)
            else original_price
         end,
         treatment_price = case
            when p_discount_pct is not null and p_discount_pct > 0 then v_new_price
            else treatment_price
         end,
         discount_pct = coalesce(p_discount_pct, 0),
         discount_reason = coalesce(p_discount_reason, discount_reason),
         commission_amount = case
            when p_discount_pct is not null and p_discount_pct > 0 then round(commission_percent / 100.0 * coalesce(original_price, v_current_price))
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

  perform log_audit('pay', p_booking_id, p_outlet_id,
    jsonb_build_object('method', p_payment_method, 'discount_pct', p_discount_pct,
      'reason', p_discount_reason, 'new_price', case when p_discount_pct is not null and p_discount_pct > 0 then v_new_price end));
end;
$function$

