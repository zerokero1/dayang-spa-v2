-- ============================================================
-- ANTI-FRAUD / AUDIT TRAIL — DAYANG SPA
--
-- Tujuan: mencatat SIAPA yang melakukan tindakan sensitif
-- (membuat booking, menandai lunas, memberi diskon, mengedit,
-- membatalkan) pada tabel bookings, agar bisa diaudit.
--
-- Isi:
--   A. Kolom baru di bookings:  created_by, paid_by, discount_pct,
--      discount_reason
--   B. Tabel audit_logs + RLS
--   C. Helper log_audit (baca auth.uid() + nama user dari tabel users)
--   D. create_booking  -> catat audit + created_by
--   E. create_booking_batch -> catat audit + created_by
--   F. mark_booking_paid -> terima p_discount_pct + p_discount_reason,
--      tulis paid_by/discount_*, catat audit
--   G. edit_booking_details -> catat audit
--   H. cancel_booking_full / cancel_booking_partial -> catat audit
--
-- JALANKAN file ini SEKALI di Supabase SQL Editor (setelah RUN, tidak
-- perlu dijalankan ulang).
-- ============================================================

-- ------------------------------------------------------------
-- A. Kolom baru di bookings (idempoten)
-- ------------------------------------------------------------
alter table bookings
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists paid_by uuid references auth.users(id),
  add column if not exists discount_pct numeric default 0,
  add column if not exists discount_reason text;

-- ------------------------------------------------------------
-- B. Tabel audit_logs + RLS
-- ------------------------------------------------------------
create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  actor_name text,
  action text not null,          -- create | pay | discount | edit | cancel | cancel_partial
  table_name text not null default 'bookings',
  record_id uuid,
  outlet_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table audit_logs enable row level security;

drop policy if exists "authenticated insert" on audit_logs;
drop policy if exists "authenticated read" on audit_logs;

-- Semua pengguna boleh MENULIS audit (dipakai fungsi RPC, dijalankan
-- dengan security definer), dan admin/berbagai role boleh MEMBACA.
create policy "authenticated insert" on audit_logs
  for insert to authenticated with check (true);

create policy "authenticated read" on audit_logs
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- C. Helper log_audit (dijalankan dari dalam fungsi RPC)
--    Keamanan: security definer agar bisa baca tabel users.
-- ------------------------------------------------------------
create or replace function log_audit(
  p_action text,
  p_record_id uuid,
  p_outlet_id text default null,
  p_detail jsonb default null
) returns void
language plpgsql
security definer
as $fn$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  select name into v_name from users where id = v_uid;
  insert into audit_logs (actor, actor_name, action, table_name, record_id, outlet_id, detail)
  values (v_uid, coalesce(v_name, 'system'), p_action, 'bookings', p_record_id, p_outlet_id, p_detail);
end;
$fn$;

grant execute on function public.log_audit(text, uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- D. create_booking — catat audit + created_by
--    (versi penuh: original_price + start/end + discount fields)
-- ------------------------------------------------------------
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
  p_original_price numeric default null,
  p_discount_reason text default null
) returns uuid
language plpgsql
as $$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end_at bigint;
  v_start_at bigint;
  v_uid uuid := auth.uid();
  v_discount_pct numeric;
begin
  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
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
$$;

grant execute on function public.create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean, numeric, text) to authenticated;
grant execute on function public.create_booking(text, uuid, text, uuid, text, numeric, numeric, int, boolean, text, text, text, boolean, text, text, boolean, numeric, text) to anon;

-- ------------------------------------------------------------
-- E. create_booking_batch — catat audit + created_by
-- ------------------------------------------------------------
create or replace function create_booking_batch(p_items jsonb, p_group_id text)
returns table (booking_id uuid)
language plpgsql as $fn$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end bigint;
  v_start bigint;
  v_ids uuid[] := '{}';
  v_uid uuid := auth.uid();
  v_discount_pct numeric;
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
      original_price numeric,
      discount_reason text
    )
  loop
    if rec.uses_oil and rec.oil_type is not null and rec.oil_size is not null then
      update oil_inventory set stock = greatest(stock - 1, 0)
       where outlet_id = rec.outlet_id and oil_type = rec.oil_type and size = rec.oil_size;
    end if;

    v_commission := round(rec.commission_percent / 100.0 * rec.treatment_price);
    v_end := v_start + coalesce(rec.duration_minutes, 0) * 60000;
    v_discount_pct := case
      when rec.original_price is not null and rec.original_price > rec.treatment_price
        then round(100 - (rec.treatment_price::numeric * 100 / rec.original_price), 1)
      else 0
    end;
    if v_discount_pct > 0 and coalesce(rec.discount_reason, '') = '' then
      raise exception 'Alasan diskon wajib diisi';
    end if;

    insert into bookings (
      outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
      treatment_price, commission_percent, commission_amount, duration_minutes,
      uses_oil, oil_type, oil_size, customer_name, status, paid, payment_method,
      group_id, start_at, end_at, created_at, original_price, created_by,
      discount_pct, discount_reason
    ) values (
      rec.outlet_id, rec.therapist_id, rec.therapist_name, rec.treatment_id, rec.treatment_name,
      rec.treatment_price, rec.commission_percent, v_commission, coalesce(rec.duration_minutes,0),
      coalesce(rec.uses_oil, true), rec.oil_type, rec.oil_size, coalesce(rec.customer_name,''),
      'berjalan', coalesce(rec.paid, false), coalesce(rec.payment_method,'cash'),
      p_group_id, v_start, v_end, now(), rec.original_price, v_uid,
      v_discount_pct, case when v_discount_pct > 0 then rec.discount_reason else null end
    ) returning id into v_booking_id;

    v_ids := v_ids || v_booking_id;
    return query select v_booking_id;
  end loop;

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

  -- Audit untuk tiap booking yang dibuat
  for rec in select id, outlet_id from bookings where id = any(v_ids) loop
    perform log_audit('create', rec.id, rec.outlet_id);
  end loop;

  return;
end;
$fn$;

grant execute on function public.create_booking_batch(jsonb, text) to authenticated;
grant execute on function public.create_booking_batch(jsonb, text) to anon;

-- ------------------------------------------------------------
-- F. mark_booking_paid — DISKON + paid_by + audit
--    Menerima p_discount_pct (0-25) dan p_discount_reason.
--    Jika diskon > 0 dan reason kosong -> error (biar wajib).
-- ------------------------------------------------------------
create or replace function mark_booking_paid(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid,
  p_payment_method text,
  p_discount_pct numeric default null,
  p_discount_reason text default null
) returns void
language plpgsql as $fn$
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
            when p_discount_pct is not null and p_discount_pct > 0 then round(commission_percent / 100.0 * v_new_price)
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
$fn$;

grant execute on function public.mark_booking_paid(text, uuid, uuid, text, numeric, text) to authenticated;
grant execute on function public.mark_booking_paid(text, uuid, uuid, text, numeric, text) to anon;

-- ------------------------------------------------------------
-- G. edit_booking_details — catat audit (harga/komisi/minyak)
-- ------------------------------------------------------------
create or replace function edit_booking_details(
  p_outlet_id text,
  p_booking_id uuid,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes int,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text
) returns void
language plpgsql as $fn$
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
    commission_amount = round(p_commission_percent / 100.0 * p_treatment_price),
    duration_minutes = p_duration_minutes,
    uses_oil = p_uses_oil,
    oil_type = case when p_uses_oil then p_oil_type else null end,
    oil_size = case when p_uses_oil then p_oil_size else null end
  where id = p_booking_id and outlet_id = p_outlet_id;

  perform log_audit('edit', p_booking_id, p_outlet_id,
    jsonb_build_object('old_price', v_old_price, 'new_price', p_treatment_price));
end;
$fn$;

grant execute on function public.edit_booking_details(text, uuid, uuid, text, numeric, numeric, int, boolean, text, text) to authenticated;
grant execute on function public.edit_booking_details(text, uuid, uuid, text, numeric, numeric, int, boolean, text, text) to anon;

-- ------------------------------------------------------------
-- H. cancel_booking_full / cancel_booking_partial — catat audit
-- ------------------------------------------------------------
create or replace function cancel_booking_full(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid
) returns void
language plpgsql as $fn$
declare
  v_uses_oil boolean;
  v_oil_type text;
  v_oil_size text;
begin
  select uses_oil, oil_type, oil_size into v_uses_oil, v_oil_type, v_oil_size
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;

  if found then
    if v_uses_oil and v_oil_type is not null and v_oil_size is not null then
      update oil_inventory
         set stock = stock + 1
       where outlet_id = p_outlet_id and oil_type = v_oil_type and size = v_oil_size;
    end if;
    update bookings set status = 'batal', cancelled_at = now(), completed_at = null
     where id = p_booking_id and outlet_id = p_outlet_id;
    perform log_audit('cancel', p_booking_id, p_outlet_id, jsonb_build_object('type','full'));
  end if;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$fn$;

grant execute on function public.cancel_booking_full(text, uuid, uuid) to authenticated;
grant execute on function public.cancel_booking_full(text, uuid, uuid) to anon;

create or replace function cancel_booking_partial(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid,
  p_new_price numeric
) returns void
language plpgsql as $fn$
declare
  v_commission_percent numeric;
  v_old_price numeric;
begin
  select commission_percent, treatment_price into v_commission_percent, v_old_price
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;

  if found then
    update bookings set
      status = 'batal_sebagian',
      original_price = v_old_price,
      treatment_price = p_new_price,
      commission_amount = round(v_commission_percent / 100.0 * p_new_price),
      cancelled_at = now()
    where id = p_booking_id and outlet_id = p_outlet_id;
    perform log_audit('cancel_partial', p_booking_id, p_outlet_id,
      jsonb_build_object('old_price', v_old_price, 'new_price', p_new_price));
  end if;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$fn$;

grant execute on function public.cancel_booking_partial(text, uuid, uuid, numeric) to authenticated;
grant execute on function public.cancel_booking_partial(text, uuid, uuid, numeric) to anon;
