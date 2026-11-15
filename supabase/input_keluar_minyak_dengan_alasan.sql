-- Jalankan pada database aplikasi sebelum menggunakan input minyak keluar.
-- Migration ini mempertahankan stok dan riwayat yang sudah ada.
begin;

create or replace function log_oil_stock_change() returns trigger
language plpgsql as $fn$
declare
  v_delta int;
  v_note text;
begin
  if tg_op = 'INSERT' then
    v_delta := new.stock;
  else
    v_delta := new.stock - old.stock;
  end if;

  if coalesce(v_delta, 0) = 0 then return null; end if;

  v_note := nullif(current_setting('dayang.oil_stock_note', true), '');
  insert into oil_inventory_logs
    (outlet_id, oil_type, size, type, qty, stock_after, note)
  values
    (new.outlet_id, new.oil_type, new.size,
     case when v_delta > 0 then 'in' else 'out' end,
     abs(v_delta), new.stock,
     coalesce(v_note, case when tg_op = 'INSERT' then 'Penambahan stok'
                           else 'Penyesuaian otomatis' end));
  return null;
end;
$fn$;

drop function if exists adjust_oil_stock(text, text, text, integer);
create function adjust_oil_stock(
  p_outlet_id text,
  p_oil_type text,
  p_size text,
  p_delta int,
  p_note text default null
) returns void
language plpgsql as $fn$
declare
  v_current int;
begin
  if p_delta = 0 then raise exception 'Jumlah perubahan stok tidak boleh nol'; end if;

  if p_delta < 0 then
    if nullif(btrim(p_note), '') is null then
      raise exception 'Alasan pengurangan stok minyak wajib diisi';
    end if;

    select stock into v_current
      from oil_inventory
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_size
     for update;
    if not found then raise exception 'Stok minyak tidak ditemukan'; end if;
    if v_current + p_delta < 0 then raise exception 'Stok minyak tidak cukup'; end if;

    perform set_config('dayang.oil_stock_note', btrim(p_note), true);
    update oil_inventory
       set stock = stock + p_delta
     where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_size;
  else
    perform set_config('dayang.oil_stock_note', '', true);
    insert into oil_inventory (outlet_id, oil_type, size, stock, unit)
    values (p_outlet_id, p_oil_type, p_size, p_delta, 'botol')
    on conflict (outlet_id, oil_type, size)
    do update set stock = oil_inventory.stock + p_delta;
  end if;
end;
$fn$;

commit;
