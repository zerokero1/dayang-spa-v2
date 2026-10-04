-- =====================================================================
-- Produk Treatment + Pemotongan Stok Otomatis
-- Tanggal : 2026-10-04
-- Tujuan :
--   1. Menambahkan kolom `category` pada tabel inventory
--      (barang lama = Laundry, produk baru = Produk)
--   2. Seeds 6 produk treatment ke seluruh outlet dengan stok awal 0
--   3. Memetakan produk ke treatment (1 booking = 1 produk)
--   4. Memotong stok produk otomatis saat booking dibuat
--   5. Mengembalikan stok produk saat booking dibatalkan/dihapus
-- Aturan : stok kurang TIDAK memblokir, stok dijepit di 0
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kategori inventory
-- ---------------------------------------------------------------------
alter table public.inventory
  add column if not exists category text not null default 'Produk';

update public.inventory set category = 'Laundry'
 where lower(name) in ('face cradle', 'hole sheet', 'single sheet');

-- ---------------------------------------------------------------------
-- 2. Fungsi bantu: potong stok produk sesuai treatment
-- ---------------------------------------------------------------------
create or replace function public.consume_treatment_products(
  p_outlet_id text,
  p_treatment_id uuid,
  p_note text default null
) returns void
language plpgsql
as $fn$
declare
  r record;
begin
  if p_treatment_id is null or coalesce(p_outlet_id, '') = '' then
    return;
  end if;

  for r in
    select c.qty, i.id
      from public.treatment_consumables c
      join public.inventory i
        on i.outlet_id = p_outlet_id
       and lower(i.name) = lower(c.item_name)
     where c.treatment_id = p_treatment_id
  loop
    -- clamp di 0: transaksi tetap jalan walau stok kurang
    update public.inventory
       set stock = greatest(stock - r.qty::integer, 0)
     where id = r.id and outlet_id = p_outlet_id;

    insert into public.inventory_logs
      (outlet_id, item_id, type, qty, note, created_at)
    values
      (p_outlet_id, r.id, 'out'::inventory_log_type, r.qty::integer,
       coalesce(p_note, 'Pemakaian otomatis treatment'), now());
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3. Fungsi bantu: kembalikan stok produk sesuai treatment
-- ---------------------------------------------------------------------
create or replace function public.restore_treatment_products(
  p_outlet_id text,
  p_treatment_id uuid,
  p_note text default null
) returns void
language plpgsql
as $fn$
declare
  r record;
begin
  if p_treatment_id is null or coalesce(p_outlet_id, '') = '' then
    return;
  end if;

  for r in
    select c.qty, i.id
      from public.treatment_consumables c
      join public.inventory i
        on i.outlet_id = p_outlet_id
       and lower(i.name) = lower(c.item_name)
     where c.treatment_id = p_treatment_id
  loop
    update public.inventory
       set stock = stock + r.qty::integer
     where id = r.id and outlet_id = p_outlet_id;

    insert into public.inventory_logs
      (outlet_id, item_id, type, qty, note, created_at)
    values
      (p_outlet_id, r.id, 'in'::inventory_log_type, r.qty::integer,
       coalesce(p_note, 'Pengembalian produk (booking dibatalkan)'), now());
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4. create_booking (single) -> potong stok produk
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_outlet_id text,
  p_therapist_id uuid,
  p_therapist_name text,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes integer,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text,
  p_customer_name text,
  p_paid boolean,
  p_payment_method text,
  p_group_id text,
  p_update_therapist boolean default true,
  p_original_price numeric default null::numeric,
  p_discount_reason text default null::text
) returns uuid
language plpgsql
as $fn$
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

  perform public.consume_treatment_products(
    p_outlet_id, p_treatment_id,
    'Otomatis: ' || coalesce(p_treatment_name, '')
  );

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
$fn$;

-- ---------------------------------------------------------------------
-- 5. create_booking_batch -> potong stok produk
-- ---------------------------------------------------------------------
create or replace function public.create_booking_batch(p_items jsonb, p_group_id text)
returns table(booking_id uuid)
language plpgsql
as $fn$
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

    perform public.consume_treatment_products(
      rec.outlet_id, rec.treatment_id,
      'Otomatis: ' || coalesce(rec.treatment_name, '')
    );

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

-- ---------------------------------------------------------------------
-- 6. continue_booking -> potong stok produk
-- ---------------------------------------------------------------------
create or replace function public.continue_booking(
  p_therapist_id uuid,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes integer,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text,
  p_customer_name text default '',
  p_paid boolean default false,
  p_payment_method text default 'cash'
) returns uuid
language plpgsql
as $fn$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_outlet text;
  v_group text;
  v_start bigint;
  v_end bigint;
  v_old_end bigint;
begin
  select current_outlet_id, current_group_id, end_at
    into v_outlet, v_group, v_old_end
    from therapists where id = p_therapist_id;

  if v_outlet is null then
    raise exception 'Terapis tidak sedang mengambil tamu';
  end if;

  v_start := (extract(epoch from now())::bigint * 1000);
  v_end := greatest(coalesce(v_old_end, v_start), v_start) + (p_duration_minutes * 60000);

  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;

  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = v_outlet and oil_type = p_oil_type and size = p_oil_size;
  end if;

  perform public.consume_treatment_products(
    v_outlet, p_treatment_id,
    'Otomatis: ' || coalesce(p_treatment_name, '')
  );

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

  update therapists t set
    current_booking_ids = coalesce(t.current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
    current_booking_id = v_booking_id::text,
    current_treatment_names = coalesce(t.current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_treatment_name),
    current_price = (select sum(treatment_price) from bookings where therapist_id = p_therapist_id and status = 'berjalan'),
    current_paid = (select bool_and(paid) from bookings where therapist_id = p_therapist_id and status = 'berjalan'),
    current_payment_method = coalesce(t.current_payment_method, p_payment_method),
    end_at = v_end
  where t.id = p_therapist_id;

  return v_booking_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 7. cancel_booking_full -> kembalikan stok produk
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking_full(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid
) returns void
language plpgsql
as $fn$
declare
  v_uses_oil boolean;
  v_oil_type text;
  v_oil_size text;
  v_treatment_id uuid;
begin
  select uses_oil, oil_type, oil_size, treatment_id
    into v_uses_oil, v_oil_type, v_oil_size, v_treatment_id
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;

  if found then
    if v_uses_oil and v_oil_type is not null and v_oil_size is not null then
      update oil_inventory
         set stock = stock + 1
       where outlet_id = p_outlet_id and oil_type = v_oil_type and size = v_oil_size;
    end if;
    perform public.restore_treatment_products(
      p_outlet_id, v_treatment_id,
      'Otomatis: pembatalan booking'
    );
    update bookings set status = 'batal', cancelled_at = now(), completed_at = null
     where id = p_booking_id and outlet_id = p_outlet_id;
    perform log_audit('cancel', p_booking_id, p_outlet_id, jsonb_build_object('type','full'));
  end if;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 8. hapus_booking_office -> kembalikan stok produk
-- ---------------------------------------------------------------------
create or replace function public.hapus_booking_office(p_booking_id uuid)
returns void
language plpgsql
as $fn$
declare
  v_outlet text;
  v_therapist uuid;
  v_uses_oil boolean;
  v_oil_type text;
  v_oil_size text;
  v_treatment_id uuid;
  v_status text;
begin
  -- ---- KEAMANAN: wajib office ----
  if not is_office_op() then
    raise exception 'Anda tidak berhak menghapus booking.';
  end if;

  select outlet_id, therapist_id, uses_oil, oil_type, oil_size, treatment_id, status
    into v_outlet, v_therapist, v_uses_oil, v_oil_type, v_oil_size, v_treatment_id, v_status
    from bookings where id = p_booking_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if v_status in ('batal', 'batal_sebagian') then
    raise exception 'Booking sudah batal.';
  end if;

  -- Kembalikan stok minyak (kalau pakai)
  if v_uses_oil and v_oil_type is not null and v_oil_size is not null then
    update oil_inventory set stock = stock + 1
     where outlet_id = v_outlet and oil_type = v_oil_type and size = v_oil_size;
  end if;

  -- Kembalikan stok produk treatment
  perform public.restore_treatment_products(
    v_outlet, v_treatment_id,
    'Otomatis: hapus booking oleh office'
  );

  -- Tandai batal (data tetap ada di DB)
  update bookings set status = 'batal', cancelled_at = now(), completed_at = null
   where id = p_booking_id;

  -- Bila sedang berjalan: perbarui session terapis
  if v_status = 'berjalan' and v_therapist is not null then
    perform refresh_therapist_session(v_therapist);
  end if;

  -- Audit
  perform log_audit('cancel', p_booking_id, v_outlet,
    jsonb_build_object('action', 'office_hapus_treatment'));
end;
$fn$;

-- ---------------------------------------------------------------------
-- 9. Seeds 6 produk treatment ke seluruh outlet (stok awal 0)
-- ---------------------------------------------------------------------
insert into public.inventory (outlet_id, name, unit, stock, unit_cost, category)
select o.id, v.item, v.unit, 0, 0, 'Produk'
  from public.outlets o
 cross join (values
    ('Facial',         'pcs'),
    ('Foot Scrub',     'pcs'),
    ('Pedicure Produk','pcs'),
    ('Manicure Produk','pcs'),
    ('Body Scrub',     'pcs'),
    ('Ear Candle',     'pcs')
  ) as v(item, unit)
on conflict (outlet_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------
-- 10. Petakan produk ke treatment (1 booking = 1 produk)
-- ---------------------------------------------------------------------
insert into public.treatment_consumables (treatment_id, item_name, qty)
select t.id, v.item, 1
  from public.treatments t
  join (values
    ('facial',      'Facial'),
    ('foot scrub',  'Foot Scrub'),
    ('pedicure',    'Pedicure Produk'),
    ('manicure',    'Manicure Produk'),
    ('body scrub',  'Body Scrub'),
    ('ear candle',  'Ear Candle')
  ) as v(pattern, item)
    on lower(t.name) like '%' || v.pattern || '%'
on conflict (treatment_id, item_name) do nothing;

-- ---------------------------------------------------------------------
-- 11. create_booking (overload lama 16 argumen) -> potong stok produk
--     Supaya jalur pemanggilan tanpa discount_reason tetap konsisten.
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_outlet_id text,
  p_therapist_id uuid,
  p_therapist_name text,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes integer,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text,
  p_customer_name text,
  p_paid boolean,
  p_payment_method text,
  p_group_id text,
  p_update_therapist boolean default true,
  p_original_price numeric default null::numeric
) returns uuid
language plpgsql
as $fn$
declare
  v_booking_id uuid;
  v_commission numeric;
  v_end_at bigint;
  v_start_at bigint;
begin
  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
  v_start_at := (extract(epoch from now())::bigint * 1000);
  v_end_at := v_start_at + (p_duration_minutes * 60000);

  if p_uses_oil and p_oil_type is not null and p_oil_size is not null then
    update oil_inventory
       set stock = greatest(stock - 1, 0)
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_oil_size;
  end if;

  perform public.consume_treatment_products(
    p_outlet_id, p_treatment_id,
    'Otomatis: ' || coalesce(p_treatment_name, '')
  );

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
$fn$;

-- ---------------------------------------------------------------------
-- 12. edit_booking_details -> tukar stok produk bila treatment diganti
-- ---------------------------------------------------------------------
create or replace function public.edit_booking_details(
  p_outlet_id text,
  p_booking_id uuid,
  p_treatment_id uuid,
  p_treatment_name text,
  p_treatment_price numeric,
  p_commission_percent numeric,
  p_duration_minutes integer,
  p_uses_oil boolean,
  p_oil_type text,
  p_oil_size text
) returns void
language plpgsql
as $fn$
declare
  v_old_uses_oil boolean;
  v_old_oil_type text;
  v_old_oil_size text;
  v_old_oil text;
  v_new_oil text;
  v_old_price numeric;
  v_old_treatment_id uuid;
begin
  select uses_oil, oil_type, oil_size, treatment_price, treatment_id
    into v_old_uses_oil, v_old_oil_type, v_old_oil_size, v_old_price, v_old_treatment_id
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

  -- Produk treatment: kembalikan yang lama, potong yang baru.
  if p_treatment_id is distinct from v_old_treatment_id then
    perform public.restore_treatment_products(
      p_outlet_id, v_old_treatment_id,
      'Otomatis: koreksi treatment'
    );
    perform public.consume_treatment_products(
      p_outlet_id, p_treatment_id,
      'Otomatis: koreksi treatment -> ' || coalesce(p_treatment_name, '')
    );
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

-- ---------------------------------------------------------------------
-- 13. edit_booking_correction -> sama, plus pindah outlet
--     Logika: kembalikan produk lama di outlet lama, potong produk akhir
--     di outlet akhir. Otomatis mencakup koreksi treatment, pindah outlet,
--     atau keduanya.
-- ---------------------------------------------------------------------
create or replace function public.edit_booking_correction(
  p_booking_id uuid,
  p_treatment_id uuid default null::uuid,
  p_treatment_name text default null::text,
  p_treatment_price numeric default null::numeric,
  p_commission_percent numeric default null::numeric,
  p_new_therapist_id uuid default null::uuid,
  p_uses_oil boolean default null::boolean,
  p_oil_type text default null::text,
  p_oil_size text default null::text,
  p_discount_pct numeric default null::numeric,
  p_discount_reason text default null::text,
  p_new_outlet_id text default null::text
) returns void
language plpgsql
set search_path TO 'public', 'pg_temp'
as $fn$
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
  v_status text;
  v_move_outlet boolean := false;
  v_fin_uses_oil boolean;
  v_fin_oil_type text;
  v_fin_oil_size text;
  v_old_treatment_id uuid;
  v_fin_treatment_id uuid;
  v_fin_outlet text;
begin
  -- ---- KEAMANAN: wajib office ----
  if not is_office_op() then
    raise exception 'Anda tidak berhak melakukan koreksi booking.';
  end if;

  -- ---- Ambil data lama ----
  select outlet_id, therapist_id, uses_oil, oil_type, oil_size,
         treatment_price, commission_percent, status, original_price, treatment_id
    into v_outlet, v_old_therapist, v_orig_uses_oil, v_old_oil_type, v_old_oil_size,
         v_new_price, v_new_commission, v_status, v_old_original, v_old_treatment_id
    from bookings where id = p_booking_id;

  if not found then raise exception 'Booking tidak ditemukan'; end if;

  if v_status in ('batal', 'batal_sebagian') then
    raise exception 'Booking sudah dibatalkan dan tidak bisa dikoreksi.';
  end if;

  v_move_outlet := p_new_outlet_id is not null
                   and btrim(p_new_outlet_id) <> ''
                   and p_new_outlet_id <> v_outlet;

  -- ---- Tentukan nilai baru (fallback ke lama) ----
  v_new_price := coalesce(p_treatment_price, v_new_price);
  v_new_commission := coalesce(p_commission_percent, v_new_commission);

  -- ---- Terapkan diskon baru (bila dikirim) ----
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

  -- ---- Update booking (termasuk pindah outlet bila diminta) ----
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
    end,
    outlet_id = case when v_move_outlet then p_new_outlet_id else outlet_id end,
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

  -- ---- Produk treatment: kembalikan di outlet lama, potong di outlet akhir ----
  -- Dijalankan bila treatment berubah atau outlet dipindah.
  if p_treatment_id is distinct from v_old_treatment_id or v_move_outlet then
    select treatment_id, outlet_id into v_fin_treatment_id, v_fin_outlet
      from bookings where id = p_booking_id;

    perform public.restore_treatment_products(
      v_outlet, v_old_treatment_id,
      'Otomatis: koreksi booking'
    );
    perform public.consume_treatment_products(
      v_fin_outlet, v_fin_treatment_id,
      'Otomatis: koreksi booking -> ' || coalesce(p_treatment_name, '')
    );
  end if;

  -- ---- Pindah stok minyak dari outlet lama ke outlet tujuan ----
  if v_move_outlet then
    select uses_oil, oil_type, oil_size
      into v_fin_uses_oil, v_fin_oil_type, v_fin_oil_size
      from bookings where id = p_booking_id;

    if coalesce(v_fin_uses_oil, false)
       and v_fin_oil_type is not null and v_fin_oil_size is not null then
      if not exists (select 1 from oil_inventory
                      where outlet_id = p_new_outlet_id
                        and oil_type = v_fin_oil_type
                        and size = v_fin_oil_size) then
        raise exception 'Minyak % (%) belum terdaftar di outlet %. Tambah stoknya dulu sebelum pindah outlet.',
          v_fin_oil_type, v_fin_oil_size, p_new_outlet_id;
      end if;

      if coalesce((select stock from oil_inventory
                    where outlet_id = p_new_outlet_id
                      and oil_type = v_fin_oil_type
                      and size = v_fin_oil_size), 0) <= 0 then
        raise exception 'Stok minyak % (%) habis di outlet tujuan (%).',
          v_fin_oil_type, v_fin_oil_size, p_new_outlet_id;
      end if;

      update oil_inventory set stock = stock + 1
       where outlet_id = v_outlet and oil_type = v_fin_oil_type and size = v_fin_oil_size;
      update oil_inventory set stock = stock - 1
       where outlet_id = p_new_outlet_id and oil_type = v_fin_oil_type and size = v_fin_oil_size;
    end if;

    perform log_audit('edit', p_booking_id, p_new_outlet_id,
      jsonb_build_object(
        'action', 'pindah_outlet',
        'outlet_dari', v_outlet,
        'outlet_ke', p_new_outlet_id,
        'oil_type', v_fin_oil_type,
        'oil_size', v_fin_oil_size
      ));
  end if;

  -- ---- Perbarui session terapis bila terapis diganti / outlet dipindah / aktif ----
  if v_old_therapist is not null
     and ((p_new_therapist_id is not null and p_new_therapist_id <> v_old_therapist)
          or v_move_outlet
          or v_status = 'berjalan') then
    perform refresh_therapist_session(v_old_therapist);
  end if;
  if p_new_therapist_id is not null and p_new_therapist_id <> v_old_therapist then
    perform refresh_therapist_session(p_new_therapist_id);
  end if;

  -- ---- Audit ----
  perform log_audit('edit', p_booking_id,
    case when v_move_outlet then p_new_outlet_id else v_outlet end,
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
      'discount_reason', p_discount_reason,
      'outlet_dari', case when v_move_outlet then v_outlet else null end,
      'outlet_ke', case when v_move_outlet then p_new_outlet_id else null end
    ));
end;
$fn$;