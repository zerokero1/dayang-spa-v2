-- Jalankan setelah manual_stok_closing.sql untuk mengaktifkan input jumlah
-- minyak masuk/keluar dengan alasan keluar yang wajib dicatat.
-- Fungsi 4 argumen lama tetap tersedia untuk APK/klien lama.
begin;

create or replace function public.adjust_oil_stock(
  p_outlet_id text,
  p_oil_type text,
  p_size text,
  p_delta integer,
  p_note text
) returns void
language plpgsql
as $fn$
declare
  v_current integer;
  v_note text;
begin
  if p_delta = 0 then
    raise exception 'Jumlah perubahan stok tidak boleh nol';
  end if;
  if p_delta < 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'Alasan pengurangan stok minyak wajib diisi';
  end if;

  select stock into v_current
    from public.oil_inventory
   where outlet_id = p_outlet_id and oil_type = p_oil_type and size = p_size
   for update;
  if p_delta < 0 and not found then
    raise exception 'Stok minyak tidak ditemukan';
  end if;
  if p_delta < 0 and v_current + p_delta < 0 then
    raise exception 'Stok minyak tidak cukup';
  end if;

  v_note := coalesce(nullif(trim(p_note), ''),
    'Penerimaan stok minyak manual');
  perform set_config('dayang.manual_oil_stock', 'on', true);
  perform set_config('dayang.oil_stock_note', v_note, true);
  insert into public.oil_inventory as current_oil (outlet_id, oil_type, size, stock, unit)
  values (p_outlet_id, p_oil_type, p_size, greatest(p_delta, 0), 'botol')
  on conflict (outlet_id, oil_type, size)
  do update set stock = current_oil.stock + p_delta;
  perform set_config('dayang.manual_oil_stock', 'off', true);
  perform set_config('dayang.oil_stock_note', '', true);
end;
$fn$;

grant execute on function public.adjust_oil_stock(text, text, text, integer, text)
  to authenticated;

commit;
