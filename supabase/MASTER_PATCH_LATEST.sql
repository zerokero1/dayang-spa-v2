-- ============================================================
-- MASTER PATCH DATABASE — DAYANG SPA  (jalankan SEKALI)
--
-- Cara: Supabase Dashboard -> SQL Editor -> New query ->
--        tempel seluruh isi file ini -> RUN
--
-- Memuat SEMUA perbaikan database terkini dalam satu file agar
-- tidak ada konflik antar patch lama/baru. Aman dijalankan ulang
-- (idempoten untuk bagian GRANT/update/insert; fungsi di-drop lalu
-- dibuat ulang ke versi TERBARU).
--
-- Isi:
--   A. GRANT EXECUTE semua fungsi RPC ke role authenticated/anon
--   B. create_booking  (versi lengkap: isi start/end + original_price)
--   C. create_booking_batch (versi lengkap + original_price)
--   D. BNS wajib minyak (update)
--   E. Stok Aloevera Cream untuk semua outlet (insert default 0)
-- ============================================================

-- ============================================================
-- A. IZIN mengeksekusi RPC (idempoten — aman dijalankan ulang)
-- ============================================================
grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all procedures in schema public to authenticated;
grant execute on all functions in schema public to anon;
grant execute on all procedures in schema public to anon;

-- ============================================================
-- B. create_booking (single) — versi TERBARU
--    - mengisi start_at/end_at di kolom therapist
--    - menerima & menyimpan original_price (diskon)
-- ============================================================
drop function if exists create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean);
drop function if exists create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean, numeric);

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
  p_update_therapist boolean default true,
  p_original_price numeric default null
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
$$;

grant execute on function public.create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean, numeric) to authenticated;
grant execute on function public.create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean, numeric) to anon;

-- ============================================================
-- C. create_booking_batch — versi TERBARU + original_price
-- ============================================================
drop function if exists create_booking_batch(jsonb, text);

create or replace function create_booking_batch(p_items jsonb, p_group_id text)
returns table (booking_id uuid)
language plpgsql as $fn$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end bigint;
  v_start bigint;
  v_ids uuid[] := '{}';
  rec record;
begin
  v_start := (extract(epoch from now())::bigint * 1000);

  for rec in
    select * from jsonb_to_recordset(p_items) as x(
      outlet_id text,
      therapist_id uuid,
      therapist_name text,
      treatment_id uuid,
      treatment_name text,
      treatment_price numeric,
      commission_percent numeric,
      duration_minutes int,
      uses_oil boolean,
      oil_type text,
      oil_size text,
      customer_name text,
      paid boolean,
      payment_method text,
      original_price numeric
    )
  loop
    if rec.uses_oil and rec.oil_type is not null and rec.oil_size is not null then
      update oil_inventory set stock = greatest(stock - 1, 0)
       where outlet_id = rec.outlet_id and oil_type = rec.oil_type and size = rec.oil_size;
    end if;

    v_commission := round(rec.commission_percent / 100.0 * rec.treatment_price);
    v_end := v_start + coalesce(rec.duration_minutes, 0) * 60000;

    insert into bookings (
      outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
      treatment_price, commission_percent, commission_amount, duration_minutes,
      uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
      group_id, start_at, end_at, created_at, original_price
    ) values (
      rec.outlet_id, rec.therapist_id, rec.therapist_name, rec.treatment_id, rec.treatment_name,
      rec.treatment_price, rec.commission_percent, v_commission, coalesce(rec.duration_minutes,0),
      coalesce(rec.uses_oil, true), rec.oil_type, rec.oil_size, coalesce(rec.customer_name,''),
      'berjalan', coalesce(rec.paid, false), coalesce(rec.payment_method,'cash'),
      p_group_id, v_start, v_end, now(), rec.original_price
    ) returning id into v_booking_id;

    v_ids := v_ids || v_booking_id;
    return query select v_booking_id;
  end loop;

  -- Agregasi status terapis untuk semua booking yang baru dibuat
  update therapists t set
    status = 'ambil_tamu',
    current_outlet_id = agg.outlet_id,
    current_booking_ids = agg.ids,
    current_booking_id = agg.ids->>0,
    current_treatment_names = agg.names,
    current_treatment_name = agg.name_str,
    current_paid = agg.all_paid,
    current_payment_method = agg.method,
    current_price = agg.total_price,
    current_group_id = p_group_id,
    start_at = v_start,
    end_at = v_start + agg.total_duration * 60000
  from (
    select
      therapist_id,
      outlet_id,
      jsonb_agg(id::text order by id::text) as ids,
      jsonb_agg(treatment_name order by id::text) as names,
      string_agg(treatment_name, ', ' order by id::text) as name_str,
      bool_and(paid) as all_paid,
      (array_agg(payment_method order by id::text))[array_length(array_agg(payment_method order by id::text),1)] as method,
      sum(coalesce(treatment_price,0)) as total_price,
      sum(coalesce(duration_minutes,0)) as total_duration
    from bookings
    where id = any(v_ids)
    group by therapist_id, outlet_id
  ) agg
  where t.id = agg.therapist_id;
end;
$fn$;

grant execute on function public.create_booking_batch(jsonb, text) to authenticated;
grant execute on function public.create_booking_batch(jsonb, text) to anon;

-- ============================================================
-- D. BNS (Back, Neck & Shoulder) wajib memakai minyak
-- ============================================================
update treatments
set uses_oil = true
where name like 'Back, Neck & Shoulder%';

-- ============================================================
-- E. Stok Aloevera Cream (default 0) untuk semua outlet
-- ============================================================
insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
select o.id, oi.oil_type, oi.size, 0, 'botol'
from (values ('DR'),('RR'),('DP'),('D1'),('D2'),('Y')) o(id)
cross join (
  values ('Aloevera Cream','Kecil'),('Aloevera Cream','Besar')
) oi(oil_type, size)
on conflict (outlet_id, oil_type, size) do nothing;
