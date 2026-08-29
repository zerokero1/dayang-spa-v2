-- ============================================================
-- DAYANG SPA v2 - Supabase Schema
-- Cara pakai:
--   1. Di <project>.supabase.co -> SQL Editor -> New query
--   2. Tempel seluruh isi file ini lalu RUN (jalankan sekali)
--   3. Setelah itu aktifkan Realtime (lihat bagian akhir)
-- ============================================================

-- ---------- Type enum (aman dijalankan ulang) ----------
do $$ begin
  create type therapist_status as enum ('free','libur','ambil_tamu','break');
exception when duplicate_object then null; end $$;
do $$ begin
  create type booking_status as enum ('berjalan','selesai','batal','batal_sebagian');
exception when duplicate_object then null; end $$;
do $$ begin
  create type reservation_status as enum ('terjadwal','checked_in','batal');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attendance_type as enum ('hadir','sakit','izin','telat','alpha','lembur');
exception when duplicate_object then null; end $$;
do $$ begin
  create type inventory_log_type as enum ('in','out');
exception when duplicate_object then null; end $$;

-- ---------- Outlets ----------
create table if not exists outlets (
  id text primary key,
  name text not null
);
insert into outlets (id, name) values
  ('DR','Dream'),('RR','Rere'),('DP','Dayang Putri'),
  ('D1','Dayang 1'),('D2','Dayang 2'),('Y','Yulis')
on conflict (id) do nothing;

-- ---------- Users (berpasangan dengan Supabase Auth) ----------
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'kasir',          -- admin_pusat | kasir | order_taker
  outlet_id text references outlets(id),
  name text not null default ''
);

-- ---------- Therapists ----------
create table if not exists therapists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'terapis',
  home_outlet_id text references outlets(id),
  shift text,
  status therapist_status not null default 'free',
  current_outlet_id text references outlets(id),
  current_booking_ids jsonb,
  current_booking_id text,
  current_treatment_names jsonb,
  current_treatment_name text,
  current_paid boolean,
  current_payment_method text,
  current_price numeric,
  current_group_id text,
  start_at bigint,
  end_at bigint
);

-- ---------- Treatments ----------
create table if not exists treatments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  category text not null default 'Massage',
  duration_minutes int not null default 60,
  commission_percent numeric not null default 20,
  uses_oil boolean
);

-- ---------- Bookings ----------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references outlets(id),
  therapist_id uuid references therapists(id),
  therapist_name text,
  treatment_id uuid references treatments(id),
  treatment_name text,
  treatment_price numeric not null default 0,
  commission_percent numeric default 0,
  commission_amount numeric default 0,
  duration_minutes int default 0,
  uses_oil boolean default true,
  oil_type text,
  oil_size text,
  customer_name text default '',
  status booking_status not null default 'berjalan',
  paid boolean not null default false,
  payment_method text default 'cash',
  group_id text,
  start_at bigint,
  end_at bigint,
  original_price numeric,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists bookings_outlet_created_idx on bookings (outlet_id, created_at);

-- ---------- Reservations ----------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references outlets(id),
  therapist_id uuid references therapists(id),
  therapist_name text,
  treatment_id uuid references treatments(id),
  treatment_name text,
  treatment_price numeric default 0,
  commission_percent numeric default 0,
  duration_minutes int default 0,
  uses_oil boolean default true,
  oil_type text,
  oil_size text,
  customer_name text default '',
  customer_phone text default '',
  scheduled_at timestamptz,
  status reservation_status not null default 'terjadwal',
  created_at timestamptz not null default now()
);

-- ---------- Oil inventory (komposit outlet + oil + size) ----------
create table if not exists oil_inventory (
  outlet_id text not null references outlets(id),
  oil_type text not null,
  size text not null,
  stock int not null default 0,
  unit text not null default 'botol',
  primary key (outlet_id, oil_type, size)
);

-- ---------- Inventory (barang non-minyak) ----------
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references outlets(id),
  name text not null,
  unit text not null default 'pcs',
  stock int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists inventory_logs (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references outlets(id),
  item_id uuid references inventory(id),
  type inventory_log_type not null,
  qty int not null default 0,
  note text default '',
  created_at timestamptz not null default now()
);

-- ---------- Attendance ----------
create table if not exists attendance (
  employee_id uuid not null,                 -- id di tabel therapists
  employee_name text,
  outlet_id text references outlets(id),
  date text not null,                        -- YYYY-MM-DD
  type attendance_type not null default 'hadir',
  overtime_minutes int not null default 0,
  note text default '',
  recorded_at timestamptz not null default now(),
  primary key (employee_id, date)
);

-- ============================================================
-- ROW LEVEL SECURITY (default aman: semua tertutup)
-- Untuk menyederhanakan, pakai policy "authenticated read/write semua"
-- (sesuaikan nanti bila butuh per-role outlet).
-- ============================================================
alter table users          enable row level security;
alter table therapists     enable row level security;
alter table treatments     enable row level security;
alter table bookings       enable row level security;
alter table reservations   enable row level security;
alter table oil_inventory  enable row level security;
alter table inventory      enable row level security;
alter table inventory_logs enable row level security;
alter table attendance     enable row level security;

drop policy if exists "authenticated all" on users;
drop policy if exists "authenticated all" on therapists;
drop policy if exists "authenticated all" on treatments;
drop policy if exists "authenticated all" on bookings;
drop policy if exists "authenticated all" on reservations;
drop policy if exists "authenticated all" on oil_inventory;
drop policy if exists "authenticated all" on inventory;
drop policy if exists "authenticated all" on inventory_logs;
drop policy if exists "authenticated all" on attendance;

create policy "authenticated all" on users          for all to authenticated using (true) with check (true);
create policy "authenticated all" on therapists     for all to authenticated using (true) with check (true);
create policy "authenticated all" on treatments     for all to authenticated using (true) with check (true);
create policy "authenticated all" on bookings       for all to authenticated using (true) with check (true);
create policy "authenticated all" on reservations   for all to authenticated using (true) with check (true);
create policy "authenticated all" on oil_inventory  for all to authenticated using (true) with check (true);
create policy "authenticated all" on inventory      for all to authenticated using (true) with check (true);
create policy "authenticated all" on inventory_logs for all to authenticated using (true) with check (true);
create policy "authenticated all" on attendance     for all to authenticated using (true) with check (true);

-- ============================================================
-- REALTIME (untuk status terapis & data yang perlu live)
-- Aktifkan tabel yang ingin realtime dengan menjalankan bagian ini.
-- ============================================================
drop publication if exists supabase_realtime;
create publication supabase_realtime for table
  therapists,
  treatments,
  bookings,
  reservations,
  oil_inventory,
  inventory,
  attendance;

-- Helper: kembalikan terapis ke free & bersihkan sesi
create or replace function clear_therapist_session(p_therapist_id uuid)
returns void language plpgsql as $$
begin
  update therapists set
    status = 'free',
    current_outlet_id = null,
    current_booking_ids = null,
    current_booking_id = null,
    current_treatment_names = null,
    current_treatment_name = null,
    current_paid = null,
    current_payment_method = null,
    current_price = null,
    current_group_id = null,
    start_at = null,
    end_at = null
  where id = p_therapist_id;
end;
$$;

-- ============================================================
-- RPC: create_booking (satu transaksi atomik)
-- Mengurangkan stok minyak + mencatat booking + update status terapis.
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
  v_stock int;
begin
  select round(p_commission_percent/100.0 * p_treatment_price) into v_commission;
  v_end_at := (extract(epoch from now())::bigint * 1000) + (p_duration_minutes * 60000);

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
    (extract(epoch from now())::bigint * 1000), v_end_at, now()
  ) returning id into v_booking_id;

  if p_update_therapist and p_therapist_id is not null then
    update therapists set
      status = 'ambil_tamu',
      current_outlet_id = p_outlet_id,
      current_booking_ids = coalesce(current_booking_ids, '[]'::jsonb) || jsonb_build_array(v_booking_id::text),
      current_treatment_names = coalesce(current_treatment_names, '[]'::jsonb) || jsonb_build_array(p_treatment_name)
    where id = p_therapist_id;
  end if;

  return v_booking_id;
end;
$$;

-- ============================================================
-- RPC: complete_booking (selesai -> kembalikan terapis ke free)
-- ============================================================
create or replace function complete_booking(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid
) returns void
language plpgsql
as $$
begin
  update bookings set status = 'selesai', completed_at = now()
   where id = p_booking_id and outlet_id = p_outlet_id;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$$;

-- ============================================================
-- RPC: mark_booking_paid (tandai LUNAS + update status terapis)
-- ============================================================
create or replace function mark_booking_paid(
  p_outlet_id text,
  p_booking_id uuid,
  p_therapist_id uuid,
  p_payment_method text
) returns void
language plpgsql as $fn$
begin
  update bookings
     set paid = true,
         payment_method = coalesce(p_payment_method, payment_method)
   where id = p_booking_id and outlet_id = p_outlet_id;

  if p_therapist_id is not null then
    update therapists
       set current_paid = true,
           current_payment_method = coalesce(p_payment_method, current_payment_method)
     where id = p_therapist_id
       and exists (
         select 1 from bookings b
         where b.id = p_booking_id and b.outlet_id = p_outlet_id
           and b.therapist_id = p_therapist_id
       );
  end if;
end;
$fn$;

-- ============================================================
-- RPC: cancel_booking_full (batal total -> kembalikan minyak)
-- ============================================================
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
  end if;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$fn$;

-- ============================================================
-- RPC: cancel_booking_partial (batal tengah -> ulang harga/komisi)
-- ============================================================
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
  end if;

  if p_therapist_id is not null then
    perform clear_therapist_session(p_therapist_id);
  end if;
end;
$fn$;

-- ============================================================
-- RPC: edit_booking_details (ubah treatment/minyak, sesuaikan stok)
-- ============================================================
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
begin
  select uses_oil, oil_type, oil_size into v_old_uses_oil, v_old_oil_type, v_old_oil_size
    from bookings where id = p_booking_id and outlet_id = p_outlet_id;
  if not found then raise exception 'Booking tidak ditemukan'; end if;

  v_old_oil  := case when v_old_uses_oil then (coalesce(v_old_oil_type,'')||'_'||coalesce(v_old_oil_size,'')) end;
  v_new_oil  := case when p_uses_oil     then (coalesce(p_oil_type,'')||'_'||coalesce(p_oil_size,'')) end;

  if v_old_oil is distinct from v_new_oil then
    -- kembalikan minyak lama
    if v_old_uses_oil and v_old_oil_type is not null and v_old_oil_size is not null then
      update oil_inventory set stock = stock + 1
       where outlet_id = p_outlet_id and oil_type = v_old_oil_type and size = v_old_oil_size;
    end if;
    -- potong minyak baru (jika ada)
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
end;
$fn$;

-- ============================================================
-- RPC: create_booking_batch (buat banyak booking sekaligus, atomik)
-- p_items = JSON array, tiap elemen:
--   outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
--   treatment_price, commission_percent, duration_minutes, uses_oil,
--   oil_type, oil_size, customer_name, paid, payment_method
-- p_group_id = id grup (null untuk single)
-- Mengurangi stok minyak, insert semua booking, lalu agregasi status
-- per terapis (append ke current_booking_ids/names, sum harga/durasi).
-- ============================================================


-- ============================================================
-- RPC: create_booking_batch (buat banyak booking sekaligus, atomik)
-- p_items = JSON array, tiap elemen:
--   outlet_id, therapist_id, therapist_name, treatment_id, treatment_name,
--   treatment_price, commission_percent, duration_minutes, uses_oil,
--   oil_type, oil_size, customer_name, paid, payment_method
-- p_group_id = id grup (null untuk single).
-- Insert semua booking + kurangi stok minyak, lalu agregasi status per
-- terapis (current_booking_ids/names, sum harga/durasi, end_at).
-- ============================================================
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
      payment_method text
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
      group_id, start_at, end_at, created_at
    ) values (
      rec.outlet_id, rec.therapist_id, rec.therapist_name, rec.treatment_id, rec.treatment_name,
      rec.treatment_price, rec.commission_percent, v_commission, coalesce(rec.duration_minutes,0),
      coalesce(rec.uses_oil, true), rec.oil_type, rec.oil_size, coalesce(rec.customer_name,''),
      'berjalan', coalesce(rec.paid, false), coalesce(rec.payment_method,'cash'),
      p_group_id, v_start, v_end, now()
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

-- ============================================================
-- RPC: adjust_oil_stock (+/- stok minyak, atomik, min 0)
-- ============================================================
create or replace function adjust_oil_stock(
  p_outlet_id text, p_oil_type text, p_size text, p_delta int
) returns void
language plpgsql as $fn$
begin
  insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
  values (p_outlet_id, p_oil_type, p_size, greatest(p_delta, 0), 'botol')
  on conflict (outlet_id, oil_type, size)
  do update set stock = greatest(oil_inventory.stock + p_delta, 0);
end;
$fn$;

-- ============================================================
-- RPC: stock_in_out (catat barang masuk/keluar + log, atomik)
-- ============================================================
create or replace function stock_in_out(
  p_outlet_id text, p_item_id uuid, p_qty int, p_note text
) returns void
language plpgsql as $fn$
declare
  v_current int;
begin
  select stock into v_current from inventory
   where id = p_item_id and outlet_id = p_outlet_id for update;

  if not found then raise exception 'Item tidak ditemukan'; end if;

  insert into inventory_logs (outlet_id, item_id, type, qty, note, created_at)
  values (p_outlet_id, p_item_id, case when p_qty >= 0 then 'in' else 'out' end, abs(p_qty), coalesce(p_note,''), now());

  if p_qty < 0 then
    update inventory set stock = v_current + p_qty  -- p_qty negatif -> kurangi
     where id = p_item_id and outlet_id = p_outlet_id;
    if v_current + p_qty < 0 then raise exception 'Stok tidak cukup'; end if;
  else
    update inventory set stock = v_current + p_qty
     where id = p_item_id and outlet_id = p_outlet_id;
  end if;
end;
$fn$;
