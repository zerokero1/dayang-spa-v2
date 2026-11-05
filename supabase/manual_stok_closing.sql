-- Apply after buku_laporan_migrasi.sql and produk_treatment_auto_stok.sql,
-- using the Supabase SQL editor as a database owner.
-- Oil and Laundry balances are counted physically at closing; bookings remain
-- visible as oil usage but do not move either balance.
-- Safe to apply more than once; existing stock and historical logs are untouched.
begin;

-- Block automatic booking/cancellation/correction writes to oil balances.
-- Manual stock RPCs set this transaction-local flag before changing stock.
create or replace function public.guard_manual_oil_stock_change()
returns trigger
language plpgsql
as $fn$
begin
  if new.stock is distinct from old.stock
     and current_setting('dayang.manual_oil_stock', true) is distinct from 'on' then
    new.stock := old.stock;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_manual_oil_stock_only on public.oil_inventory;
create trigger trg_manual_oil_stock_only
  before update of stock on public.oil_inventory
  for each row execute function public.guard_manual_oil_stock_change();

create or replace function public.log_oil_stock_change()
returns trigger
language plpgsql
as $fn$
declare
  v_delta integer;
  v_note text;
begin
  if tg_op = 'INSERT' then
    v_delta := new.stock;
  else
    v_delta := new.stock - old.stock;
  end if;
  if coalesce(v_delta, 0) = 0 then return null; end if;

  v_note := nullif(current_setting('dayang.oil_stock_note', true), '');
  if v_note is null then
    v_note := case when tg_op = 'INSERT' then 'Penambahan stok manual'
                   else 'Penyesuaian stok manual' end;
  end if;

  insert into public.oil_inventory_logs
    (outlet_id, oil_type, size, type, qty, stock_after, note)
  values
    (new.outlet_id, new.oil_type, new.size,
     case when v_delta > 0 then 'in' else 'out' end,
     abs(v_delta), new.stock, v_note);
  return null;
end;
$fn$;

create or replace function public.adjust_oil_stock(
  p_outlet_id text,
  p_oil_type text,
  p_size text,
  p_delta integer
) returns void
language plpgsql
as $fn$
begin
  perform set_config('dayang.manual_oil_stock', 'on', true);
  perform set_config('dayang.oil_stock_note', 'Penyesuaian stok minyak manual', true);
  insert into public.oil_inventory as current_oil (outlet_id, oil_type, size, stock, unit)
  values (p_outlet_id, p_oil_type, p_size, greatest(p_delta, 0), 'botol')
  on conflict (outlet_id, oil_type, size)
  do update set stock = greatest(current_oil.stock + p_delta, 0);
  perform set_config('dayang.manual_oil_stock', 'off', true);
  perform set_config('dayang.oil_stock_note', '', true);
end;
$fn$;

create or replace function public.set_oil_closing_stock(
  p_outlet_id text,
  p_oil_type text,
  p_size text,
  p_stock integer,
  p_note text default null
) returns void
language plpgsql
as $fn$
declare
  v_current integer;
  v_delta integer;
  v_note text;
begin
  if p_stock is null or p_stock < 0 then
    raise exception 'Jumlah stok minyak closing harus minimal 0';
  end if;

  select stock into v_current
    from public.oil_inventory
   where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_size
   for update;
  if not found then v_current := 0; end if;
  v_delta := p_stock - coalesce(v_current, 0);
  v_note := 'Opname fisik penutupan ' ||
    to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD');
  if coalesce(trim(p_note), '') <> '' then v_note := v_note || ' - ' || trim(p_note); end if;

  perform set_config('dayang.manual_oil_stock', 'on', true);
  perform set_config('dayang.oil_stock_note', v_note, true);
  insert into public.oil_inventory (outlet_id, oil_type, size, stock, unit)
  values (p_outlet_id, p_oil_type, p_size, p_stock, 'botol')
  on conflict (outlet_id, oil_type, size)
  do update set stock = excluded.stock;
  perform set_config('dayang.manual_oil_stock', 'off', true);
  perform set_config('dayang.oil_stock_note', '', true);

  if v_delta = 0 then
    insert into public.oil_inventory_logs
      (outlet_id, oil_type, size, type, qty, stock_after, note)
    values
      (p_outlet_id, p_oil_type, p_size, 'in', 0, p_stock, v_note);
  end if;
end;
$fn$;

grant execute on function public.adjust_oil_stock(text, text, text, integer)
  to authenticated;
grant execute on function public.set_oil_closing_stock(text, text, text, integer, text)
  to authenticated;

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
       and lower(coalesce(i.category, 'Produk')) <> 'laundry'
     where c.treatment_id = p_treatment_id
  loop
    update public.inventory
       set stock = greatest(stock - r.qty::integer, 0)
     where id = r.id and outlet_id = p_outlet_id;

    insert into public.inventory_logs
      (outlet_id, item_id, type, qty, note, created_at)
    values
      (p_outlet_id, r.id, 'out'::public.inventory_log_type, r.qty::integer,
       coalesce(p_note, 'Pemakaian otomatis treatment'), now());
  end loop;
end;
$fn$;

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
       and lower(coalesce(i.category, 'Produk')) <> 'laundry'
     where c.treatment_id = p_treatment_id
  loop
    update public.inventory
       set stock = stock + r.qty::integer
     where id = r.id and outlet_id = p_outlet_id;

    insert into public.inventory_logs
      (outlet_id, item_id, type, qty, note, created_at)
    values
      (p_outlet_id, r.id, 'in'::public.inventory_log_type, r.qty::integer,
       coalesce(p_note, 'Pengembalian produk (booking dibatalkan)'), now());
  end loop;
end;
$fn$;

create or replace function public.set_laundry_closing_stock(
  p_outlet_id text,
  p_item_id uuid,
  p_stock integer,
  p_note text default null
) returns void
language plpgsql
as $fn$
declare
  v_current integer;
  v_category text;
  v_delta integer;
  v_log_note text;
begin
  if p_stock is null or p_stock < 0 then
    raise exception 'Jumlah stok closing harus minimal 0';
  end if;

  select coalesce(stock, 0), category
    into v_current, v_category
    from public.inventory
   where id = p_item_id and outlet_id = p_outlet_id
   for update;

  if not found then
    raise exception 'Item tidak ditemukan';
  end if;
  if lower(coalesce(v_category, 'Produk')) <> 'laundry' then
    raise exception 'Hitungan stok closing hanya berlaku untuk item Laundry';
  end if;

  v_delta := p_stock - v_current;
  v_log_note := 'Opname fisik penutupan ' ||
    to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD');
  if coalesce(trim(p_note), '') <> '' then
    v_log_note := v_log_note || ' - ' || trim(p_note);
  end if;

  update public.inventory
     set stock = p_stock
   where id = p_item_id and outlet_id = p_outlet_id;

  insert into public.inventory_logs
    (outlet_id, item_id, type, qty, note, created_at)
  values
    (p_outlet_id, p_item_id,
     (case when v_delta < 0 then 'out' else 'in' end)::public.inventory_log_type,
     abs(v_delta), v_log_note, now());
end;
$fn$;

grant execute on function public.set_laundry_closing_stock(text, uuid, integer, text)
  to authenticated;

commit;
